"""Discovery endpoints — server-side proxy for Civitai and HuggingFace.

All external requests flow through the Orchestrator so API keys never
leave the server.  Results are returned as-is from the upstream APIs
(the frontend shapes them for display).
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from orchestrator.api import key_store

router = APIRouter(prefix="/api/discover", tags=["discover"])

# 1-hour cache for base models list
_BASE_MODELS_CACHE: dict[str, Any] = {"ts": 0.0, "data": []}
_BASE_MODELS_TTL = 3600.0

_CIVITAI_BASE = "https://civitai.com/api/v1"
_HF_BASE = "https://huggingface.co/api"

# ── Key management ─────────────────────────────────────────────────────────────


class KeyRequest(BaseModel):
    platform: str   # "civitai" | "huggingface"
    value: str


@router.get("/keys")
async def get_keys():
    """Return masked values for configured API keys."""
    return {
        "civitai": key_store.mask_key(key_store.get_key("civitai")),
        "huggingface": key_store.mask_key(key_store.get_key("huggingface")),
    }


@router.post("/keys")
async def set_key(req: KeyRequest):
    if req.platform not in ("civitai", "huggingface"):
        raise HTTPException(status_code=400, detail="Unknown platform")
    key_store.set_key(req.platform, req.value.strip() or None)
    return {"ok": True, "masked": key_store.mask_key(req.value)}


@router.delete("/keys/{platform}")
async def delete_key(platform: str):
    if platform not in ("civitai", "huggingface"):
        raise HTTPException(status_code=400, detail="Unknown platform")
    key_store.set_key(platform, None)
    return {"ok": True}


# ── Civitai ────────────────────────────────────────────────────────────────────


def _civitai_headers() -> dict[str, str]:
    key = key_store.get_key("civitai")
    return {"Authorization": f"Bearer {key}"} if key else {}


@router.get("/civitai/models")
async def civitai_search(
    query: str = Query(""),
    types: str = Query(""),         # comma-separated: Checkpoint,LORA,Controlnet,VAE,...
    sort: str = Query("Most Downloaded"),
    period: str = Query("AllTime"),
    base_models: str = Query(""),   # comma-separated
    nsfw: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query(""),
) -> Any:
    # httpx accepts list values → repeated params (?types=X&types=Y)
    params: list[tuple[str, str]] = [
        ("limit", str(limit)),
        ("sort", sort),
        ("period", period),
        ("nsfw", str(nsfw).lower()),
    ]
    if query:
        params.append(("query", query))
    for t in (types or "").split(","):
        t = t.strip()
        if t:
            params.append(("types", t))
    for bm in (base_models or "").split(","):
        bm = bm.strip()
        if bm:
            params.append(("baseModels", bm))
    if cursor:
        params.append(("cursor", cursor))

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{_CIVITAI_BASE}/models",
                params=params,
                headers=_civitai_headers(),
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Civitai unreachable: {exc}")


@router.get("/civitai/models/{model_id}")
async def civitai_model_detail(model_id: int) -> Any:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{_CIVITAI_BASE}/models/{model_id}",
                headers=_civitai_headers(),
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"Civitai unreachable: {exc}")


@router.get("/civitai/base-models")
async def civitai_base_models() -> Any:
    """Return a merged list of known Civitai base model names.

    Combines an expanded hardcoded list with values extracted from a live
    Civitai query (cached 1 hour) so the filter dropdown stays current as
    new base models are added on Civitai.
    """
    # Comprehensive static list — covers all known bases as of 2025
    STATIC_BASE_MODELS = [
        # Stable Diffusion 1.x / 2.x
        "SD 1.4", "SD 1.5", "SD 1.5 LCM", "SD 1.5 Hyper",
        "SD 2.0", "SD 2.0 768", "SD 2.1", "SD 2.1 768", "SD 2.1 Unclip",
        # SDXL family
        "SDXL 1.0", "SDXL 1.0 LCM", "SDXL Distilled", "SDXL Hyper",
        "SDXL Turbo", "SDXL Lightning", "SDXL Merge",
        "Stable Cascade",
        # Pony / Illustrious / NoobAI
        "Pony", "Illustrious", "NoobAI", "AstolfoMix",
        # SD 3.x
        "SD 3", "SD 3.5", "SD 3.5 Medium", "SD 3.5 Large", "SD 3.5 Large Turbo",
        # Flux family
        "Flux.1 D", "Flux.1 S", "Flux.1 Dev", "Flux.1 Schnell",
        "Flux.1 [dev] fp8", "FLUX.1 Merge", "FLUX Klein",
        "Flux.1 Hyper",
        # Video models
        "HunyuanVideo", "Wan Video", "LTX-Video", "CogVideoX",
        "CogVideoX-5B", "Mochi",
        # Image models
        "AuraFlow", "Kolors", "PixArt-α", "PixArt-Σ",
        "HunyuanDiT", "Lumina",
        # Inpainting / specialised
        "SDXL Inpainting", "SD 1.5 Inpainting",
        # Catch-all
        "Other",
    ]

    # Return cached live data if fresh
    if time.monotonic() - _BASE_MODELS_CACHE["ts"] < _BASE_MODELS_TTL and _BASE_MODELS_CACHE["data"]:
        return {"base_models": _BASE_MODELS_CACHE["data"]}

    # Attempt to augment with live Civitai data
    live_bases: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{_CIVITAI_BASE}/models",
                params=[("limit", "100"), ("sort", "Highest Rated"), ("period", "Month")],
                headers=_civitai_headers(),
            )
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("items", []):
                    for ver in item.get("modelVersions", []):
                        bm = ver.get("baseModel", "")
                        if bm and bm not in live_bases:
                            live_bases.append(bm)
    except Exception:
        pass  # Fall back to static list

    # Merge: static first, then any live entries not already present
    merged = list(STATIC_BASE_MODELS)
    static_lower = {b.lower() for b in merged}
    for b in live_bases:
        if b.lower() not in static_lower:
            merged.append(b)
            static_lower.add(b.lower())

    merged.sort()
    _BASE_MODELS_CACHE["ts"] = time.monotonic()
    _BASE_MODELS_CACHE["data"] = merged
    return {"base_models": merged}


# ── HuggingFace ────────────────────────────────────────────────────────────────


def _hf_headers() -> dict[str, str]:
    token = key_store.get_key("huggingface")
    headers: dict[str, str] = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


@router.get("/huggingface/models")
async def hf_search(
    query: str = Query(""),
    filter: str = Query(""),        # e.g. "text-to-image"
    sort: str = Query("downloads"),
    limit: int = Query(20, ge=1, le=100),
    cursor: str = Query(""),
) -> Any:
    params: list[tuple[str, str]] = [
        ("limit", str(limit)),
        ("sort", sort),
        ("direction", "-1"),
        ("full", "true"),
    ]
    if query:
        params.append(("search", query))
    if filter:
        params.append(("filter", filter))
    if cursor:
        params.append(("cursor", cursor))

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{_HF_BASE}/models", params=params, headers=_hf_headers()
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"HuggingFace unreachable: {exc}")


@router.get("/huggingface/models/{repo_id:path}/files")
async def hf_model_files(repo_id: str) -> Any:
    """Return the file list for a HuggingFace repo (model files only)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{_HF_BASE}/models/{repo_id}", headers=_hf_headers()
            )
            resp.raise_for_status()
            data = resp.json()
            model_exts = {".safetensors", ".gguf", ".bin", ".pt", ".ckpt"}
            siblings = [
                {
                    "filename": s.get("rfilename", ""),
                    "size": s.get("size", 0),
                }
                for s in data.get("siblings", [])
                if any(s.get("rfilename", "").endswith(e) for e in model_exts)
            ]
            return {
                "model_id": repo_id,
                "downloads": data.get("downloads", 0),
                "likes": data.get("likes", 0),
                "tags": data.get("tags", []),
                "siblings": siblings,
                "card_data": data.get("cardData", {}),
            }
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=f"HuggingFace unreachable: {exc}")
