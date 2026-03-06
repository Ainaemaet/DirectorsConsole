"""Download task API — create, monitor, cancel model downloads."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from orchestrator.download_manager import download_manager

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


# ── Request models ─────────────────────────────────────────────────────────────


class CivitaiDownloadRequest(BaseModel):
    filename: str
    target_path: str          # absolute path where file is saved
    download_url: str
    preview_url: str = ""
    metadata: dict[str, Any] = {}


class HuggingFaceDownloadRequest(BaseModel):
    repo_id: str
    filename: str
    target_path: str          # absolute path where file is saved
    hf_subfolder: str = ""


class DirectDownloadRequest(BaseModel):
    url: str
    filename: str
    target_path: str


# ── Helpers ────────────────────────────────────────────────────────────────────


def _validate_target_path(target_path: str) -> Path:
    """Basic safety check — must be absolute, no traversal."""
    path = Path(target_path)
    if not path.is_absolute():
        raise HTTPException(status_code=400, detail="target_path must be absolute")
    parts = path.parts
    if ".." in parts:
        raise HTTPException(status_code=400, detail="Path traversal not allowed")
    return path


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("")
async def list_tasks():
    return {"tasks": download_manager.list_tasks()}


@router.post("/civitai")
async def start_civitai(req: CivitaiDownloadRequest):
    _validate_target_path(req.target_path)
    task_id = download_manager.create_task(
        filename=req.filename,
        target_path=req.target_path,
        download_url=req.download_url,
        source="civitai",
        metadata=req.metadata,
        preview_url=req.preview_url,
    )
    return {"task_id": task_id}


@router.post("/huggingface")
async def start_huggingface(req: HuggingFaceDownloadRequest):
    _validate_target_path(req.target_path)
    subfolder = f"{req.hf_subfolder.strip('/')}/" if req.hf_subfolder.strip("/") else ""
    url = f"https://huggingface.co/{req.repo_id}/resolve/main/{subfolder}{req.filename}"
    task_id = download_manager.create_task(
        filename=req.filename,
        target_path=req.target_path,
        download_url=url,
        source="huggingface",
    )
    return {"task_id": task_id}


@router.post("/direct")
async def start_direct(req: DirectDownloadRequest):
    _validate_target_path(req.target_path)
    task_id = download_manager.create_task(
        filename=req.filename,
        target_path=req.target_path,
        download_url=req.url,
        source="direct",
    )
    return {"task_id": task_id}


@router.get("/{task_id}/progress")
async def task_progress_sse(task_id: str):
    """Server-Sent Events stream of progress for a single task.
    Client should close the connection once it receives status done/failed/cancelled.
    """

    async def event_gen():
        while True:
            task = download_manager.get_task(task_id)
            if task is None:
                yield f"data: {json.dumps({'error': 'not_found'})}\n\n"
                return
            yield f"data: {json.dumps(task.to_dict())}\n\n"
            if task.status in ("done", "failed", "cancelled"):
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{task_id}/pause")
async def pause_task(task_id: str):
    """Pause an active download (saves position; resume restarts with Range header)."""
    if not download_manager.pause(task_id):
        raise HTTPException(status_code=409, detail="Task not downloading or not found")
    return {"ok": True}


@router.post("/{task_id}/resume")
async def resume_task(task_id: str):
    """Resume a paused download from the saved byte offset."""
    if not download_manager.resume(task_id):
        raise HTTPException(status_code=409, detail="Task not paused or not found")
    download_manager._ensure_workers()
    return {"ok": True}


class PriorityRequest(BaseModel):
    priority: int   # 1 (highest) – 9 (lowest)


@router.post("/{task_id}/priority")
async def set_task_priority(task_id: str, req: PriorityRequest):
    """Change the queue priority of a pending task (1=highest, 9=lowest)."""
    if not download_manager.set_priority(task_id, req.priority):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


class MaxConcurrentRequest(BaseModel):
    max_concurrent: int


@router.post("/settings/max-concurrent")
async def set_max_concurrent(req: MaxConcurrentRequest):
    """Update the max concurrent downloads (1–8)."""
    download_manager.set_max_concurrent(req.max_concurrent)
    return {"ok": True, "max_concurrent": download_manager._max_concurrent}


@router.delete("/{task_id}")
async def cancel_task(task_id: str):
    """Cancel an in-progress download (leaves any partial file cleaned up)."""
    if not download_manager.cancel(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@router.delete("/{task_id}/remove")
async def remove_task(task_id: str):
    """Cancel and remove a task from the list entirely."""
    if not download_manager.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}
