"""Discovery endpoints — server-side proxy for Civitai and HuggingFace.

All external requests flow through the Orchestrator so API keys never
leave the server.  Results are returned as-is from the upstream APIs
(the frontend shapes them for display).
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from orchestrator.api import key_store

router = APIRouter(prefix="/api/discover", tags=["discover"])

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
