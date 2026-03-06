"""Model Browser API routes for Director's Console.

Scans ComfyUI model directories (discovered via extra_model_paths.yaml) and reads
sidecar files (*.metadata.json, *.civitai.info, preview images, *.md notes) to
serve a self-contained model browser — no dependency on ComfyUI-Model-Manager.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import struct
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODEL_EXTENSIONS: set[str] = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"}

# Keys in extra_model_paths.yaml that are not model category paths
SKIP_YAML_KEYS: set[str] = {
    "is_default",
    "base_path",
    "download_model_base",
    "configs",
    "custom_nodes",
    "animatediff_video_formats",
}

# Preview image extensions to look for (in priority order)
PREVIEW_IMAGE_EXTS: list[str] = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".bmp"]
PREVIEW_VIDEO_EXTS: list[str] = [".mp4", ".webm"]
ALL_PREVIEW_EXTS: list[str] = PREVIEW_VIDEO_EXTS + PREVIEW_IMAGE_EXTS

router = APIRouter(prefix="/api/model-browser", tags=["model-browser"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ConfigResponse(BaseModel):
    """Response for /config endpoint."""

    success: bool
    categories: dict[str, list[str]]
    message: str = ""


class ModelEntry(BaseModel):
    """A single model file with its sidecar metadata."""

    name: str
    filename: str
    path: str
    category: str
    subfolder: str
    size_bytes: int
    modified: float
    base_model: str
    sha256: str
    preview_path: str
    has_metadata: bool
    trained_words: list[str]
    tags: list[str]
    description: str
    notes: str


class ModelsResponse(BaseModel):
    """Response for /models endpoint."""

    success: bool
    models: list[ModelEntry]
    message: str = ""


class ModelDetailResponse(BaseModel):
    """Response for /model-detail endpoint."""

    success: bool
    metadata: dict[str, Any]
    notes_md: str
    safetensors_meta: dict[str, str]
    message: str = ""


# ---------------------------------------------------------------------------
# Path safety (mirrors server.py helpers — kept local to avoid circular import)
# ---------------------------------------------------------------------------


def _is_path_safe(file_path: str | Path) -> tuple[bool, str]:
    """Basic path traversal check."""
    try:
        original_str = str(file_path)
        # Block explicit traversal attempts
        parts = re.split(r"[/\\]", original_str)
        if ".." in parts:
            return False, f"Path traversal attempt detected in: {file_path}"
        Path(file_path).resolve()  # Validate parseable
        return True, ""
    except Exception as e:
        return False, f"Invalid path: {e}"


# ---------------------------------------------------------------------------
# YAML parsing helpers
# ---------------------------------------------------------------------------


def _parse_extra_model_paths(yaml_path: Path) -> dict[str, list[str]]:
    """Parse extra_model_paths.yaml → {category: [absolute_paths]}.

    Handles:
    - Single-path values (plain string)
    - Multi-path values (YAML literal block scalar → newline-separated string)
    - Relative paths resolved against base_path if present
    """
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not isinstance(data, dict):
        return {}

    categories: dict[str, list[str]] = {}

    for _section_name, section in data.items():
        if not isinstance(section, dict):
            continue

        base_path = section.get("base_path", "")

        for key, value in section.items():
            if key in SKIP_YAML_KEYS:
                continue
            if value is None:
                continue

            # Collect raw path strings
            raw_paths: list[str] = []
            if isinstance(value, str):
                # May be multi-line (pipe block) or single line
                for line in value.splitlines():
                    line = line.strip()
                    if line:
                        raw_paths.append(line)
            elif isinstance(value, list):
                raw_paths = [str(p).strip() for p in value if p]
            else:
                raw_paths = [str(value).strip()]

            # Resolve relative paths against base_path
            resolved: list[str] = []
            for p in raw_paths:
                path_obj = Path(p)
                if not path_obj.is_absolute() and base_path:
                    path_obj = Path(base_path) / path_obj
                resolved.append(str(path_obj))

            if resolved:
                if key in categories:
                    categories[key].extend(resolved)
                else:
                    categories[key] = resolved

    return categories


# ---------------------------------------------------------------------------
# Sidecar reading helpers
# ---------------------------------------------------------------------------


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode HTML entities."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return text.strip()


def _find_preview(model_path: Path) -> str:
    """Find the best preview image/video for a model file.

    Priority order:
    1. Path stored in metadata.json's preview_url field (already resolved by caller)
    2. {stem}{ext} — direct match (e.g. model.webp)
    3. {stem}.preview{ext} — explicit preview variant (e.g. model.preview.png)
    """
    stem = model_path.stem
    parent = model_path.parent

    for ext in ALL_PREVIEW_EXTS:
        candidate = parent / f"{stem}{ext}"
        if candidate.exists():
            return str(candidate)
        candidate = parent / f"{stem}.preview{ext}"
        if candidate.exists():
            return str(candidate)

    return ""


def _read_metadata_json(model_path: Path) -> tuple[dict[str, Any], bool]:
    """Read {stem}.metadata.json or {stem}.civitai.info. Returns (data, found)."""
    stem = model_path.stem
    parent = model_path.parent

    for suffix in [".metadata.json", ".civitai.info", ".json"]:
        candidate = parent / f"{stem}{suffix}"
        if candidate.exists():
            try:
                with open(candidate, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data, True
            except Exception:
                continue

    return {}, False


def _extract_model_entry(
    model_path: Path, category: str, category_root: Path
) -> ModelEntry:
    """Build a ModelEntry from a model file path."""
    stat = model_path.stat()
    stem = model_path.stem

    metadata, has_metadata = _read_metadata_json(model_path)

    # Display name
    name = metadata.get("model_name") or metadata.get("file_name") or stem

    # Base model
    base_model = metadata.get("base_model", "")
    if not base_model:
        civitai = metadata.get("civitai", {})
        base_model = civitai.get("baseModel", "") if isinstance(civitai, dict) else ""

    # SHA256
    sha256 = metadata.get("sha256", "")

    # Preview: try metadata.preview_url first, then scan filesystem
    preview_path = ""
    meta_preview = metadata.get("preview_url", "")
    if meta_preview and Path(meta_preview).exists():
        preview_path = meta_preview
    if not preview_path:
        preview_path = _find_preview(model_path)

    # Trained words
    trained_words: list[str] = []
    civitai = metadata.get("civitai", {})
    if isinstance(civitai, dict):
        tw = civitai.get("trainedWords", [])
        if isinstance(tw, list):
            trained_words = [str(w) for w in tw if w]

    # Tags
    tags: list[str] = []
    if isinstance(civitai, dict):
        model_block = civitai.get("model", {})
        if isinstance(model_block, dict):
            t = model_block.get("tags", [])
            if isinstance(t, list):
                tags = [str(tag) for tag in t if tag]

    # Description
    description = ""
    if isinstance(civitai, dict):
        model_block = civitai.get("model", {})
        if isinstance(model_block, dict):
            raw_desc = model_block.get("description", "") or ""
            description = _strip_html(str(raw_desc))

    # Notes from metadata
    notes = metadata.get("notes", "") or ""

    # Subfolder relative to category root
    try:
        subfolder = str(model_path.parent.relative_to(category_root))
        if subfolder == ".":
            subfolder = ""
    except ValueError:
        subfolder = ""

    return ModelEntry(
        name=name,
        filename=model_path.name,
        path=str(model_path),
        category=category,
        subfolder=subfolder,
        size_bytes=int(stat.st_size),
        modified=stat.st_mtime,
        base_model=base_model,
        sha256=sha256,
        preview_path=preview_path,
        has_metadata=has_metadata,
        trained_words=trained_words,
        tags=tags,
        description=description,
        notes=str(notes),
    )


def _scan_category_paths(
    category: str, paths: list[str]
) -> list[ModelEntry]:
    """Scan all directory paths for a category and return ModelEntry list."""
    entries: list[ModelEntry] = []

    for path_str in paths:
        root = Path(path_str)
        if not root.exists() or not root.is_dir():
            continue

        for dirpath, _dirnames, filenames in os.walk(root):
            dir_path = Path(dirpath)
            for filename in filenames:
                file_path = dir_path / filename
                if file_path.suffix.lower() not in MODEL_EXTENSIONS:
                    continue
                try:
                    entry = _extract_model_entry(file_path, category, root)
                    entries.append(entry)
                except Exception:
                    # Skip unreadable files silently
                    pass

    return entries


def _read_safetensors_meta(model_path: Path) -> dict[str, str]:
    """Read __metadata__ from a safetensors file header (pure Python)."""
    if model_path.suffix.lower() != ".safetensors":
        return {}
    try:
        with open(model_path, "rb") as f:
            raw_len = f.read(8)
            if len(raw_len) < 8:
                return {}
            header_len = struct.unpack("<Q", raw_len)[0]
            if header_len > 100 * 1024 * 1024:
                # Sanity cap: don't read >100 MB headers
                return {}
            header_bytes = f.read(min(header_len, 1024 * 1024))
            header = json.loads(header_bytes)
            meta = header.get("__metadata__", {})
            if isinstance(meta, dict):
                # Safetensors metadata values are always strings
                return {k: str(v) for k, v in meta.items()}
    except Exception:
        pass
    return {}


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.get("/config", response_model=ConfigResponse)
async def get_config(
    comfy_ui_path: str = Query(..., description="Path to ComfyUI installation directory"),
) -> ConfigResponse:
    """Parse extra_model_paths.yaml and return all model categories with their paths."""
    is_safe, err = _is_path_safe(comfy_ui_path)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"Invalid path: {err}")

    yaml_path = Path(comfy_ui_path) / "extra_model_paths.yaml"

    def _load() -> dict[str, list[str]]:
        if not yaml_path.exists():
            raise FileNotFoundError(f"extra_model_paths.yaml not found at: {yaml_path}")
        return _parse_extra_model_paths(yaml_path)

    try:
        categories = await asyncio.to_thread(_load)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse YAML: {e}")

    return ConfigResponse(success=True, categories=categories)


@router.get("/models", response_model=ModelsResponse)
async def get_models(
    category: str = Query(..., description="Model category (e.g. 'loras', 'checkpoints')"),
    comfy_ui_path: str = Query(..., description="Path to ComfyUI installation directory"),
) -> ModelsResponse:
    """Scan all directories for the given category and return model entries with sidecar data."""
    is_safe, err = _is_path_safe(comfy_ui_path)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"Invalid path: {err}")

    yaml_path = Path(comfy_ui_path) / "extra_model_paths.yaml"

    def _load_and_scan() -> list[ModelEntry]:
        if not yaml_path.exists():
            raise FileNotFoundError(f"extra_model_paths.yaml not found at: {yaml_path}")
        all_categories = _parse_extra_model_paths(yaml_path)
        paths = all_categories.get(category, [])
        if not paths:
            return []
        return _scan_category_paths(category, paths)

    try:
        models = await asyncio.to_thread(_load_and_scan)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan models: {e}")

    return ModelsResponse(success=True, models=models)


@router.get("/model-detail", response_model=ModelDetailResponse)
async def get_model_detail(
    model_path: str = Query(..., description="Absolute path to the model file"),
) -> ModelDetailResponse:
    """Return full sidecar data for one model: metadata JSON, notes markdown, safetensors header."""
    is_safe, err = _is_path_safe(model_path)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"Invalid path: {err}")

    def _load_detail() -> tuple[dict[str, Any], str, dict[str, str]]:
        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(f"Model not found: {model_path}")

        # Full metadata JSON
        metadata, _ = _read_metadata_json(path)

        # Notes markdown
        notes_md = ""
        notes_path = path.parent / f"{path.stem}.md"
        if notes_path.exists():
            try:
                notes_md = notes_path.read_text(encoding="utf-8")
            except Exception:
                pass

        # Safetensors header metadata
        safetensors_meta = _read_safetensors_meta(path)

        return metadata, notes_md, safetensors_meta

    try:
        metadata, notes_md, safetensors_meta = await asyncio.to_thread(_load_detail)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read model detail: {e}")

    return ModelDetailResponse(
        success=True,
        metadata=metadata,
        notes_md=notes_md,
        safetensors_meta=safetensors_meta,
    )
