"""Background download manager for Director's Console.

Handles model downloads from Civitai, HuggingFace, and direct URLs.
After a model file is saved, automatically fetches the best available
preview (video prioritised for video models, image otherwise) and
writes a sidecar .metadata.json.

Architecture:
- DownloadTask: dataclass tracking state for one download
- DownloadManager: in-memory task registry + asyncio-based downloader
  - Max 2 concurrent downloads (configurable semaphore)
  - Streams chunks via httpx, writes to .part file, atomic rename
  - BPS calculated over a rolling 3-second window
  - On completion increments cache_version so model browser cache is invalidated
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

from orchestrator.api import key_store


class TaskStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DownloadTask:
    task_id: str
    filename: str
    target_path: str
    download_url: str
    source: str                          # "civitai" | "huggingface" | "direct"
    status: TaskStatus = TaskStatus.QUEUED
    downloaded_bytes: int = 0
    total_bytes: int = 0
    bps: float = 0.0
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    preview_url: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        total = max(self.total_bytes, 1)
        return {
            "task_id": self.task_id,
            "filename": self.filename,
            "target_path": self.target_path,
            "source": self.source,
            "status": self.status,
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "bps": round(self.bps, 1),
            "error": self.error,
            "progress": round(self.downloaded_bytes / total * 100, 1),
        }


class DownloadManager:
    def __init__(self, max_concurrent: int = 2) -> None:
        self._tasks: dict[str, DownloadTask] = {}
        self._cancel_flags: dict[str, asyncio.Event] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)
        # Incremented whenever a download completes — model browser cache checks this
        self.cache_version: int = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def create_task(
        self,
        filename: str,
        target_path: str,
        download_url: str,
        source: str,
        metadata: dict[str, Any] | None = None,
        preview_url: str = "",
    ) -> str:
        task_id = str(uuid.uuid4())
        task = DownloadTask(
            task_id=task_id,
            filename=filename,
            target_path=target_path,
            download_url=download_url,
            source=source,
            metadata=metadata or {},
            preview_url=preview_url,
        )
        self._tasks[task_id] = task
        self._cancel_flags[task_id] = asyncio.Event()
        asyncio.create_task(self._run(task_id))
        return task_id

    def cancel(self, task_id: str) -> bool:
        if task_id not in self._tasks:
            return False
        self._cancel_flags[task_id].set()
        task = self._tasks[task_id]
        if task.status in (TaskStatus.QUEUED, TaskStatus.DOWNLOADING):
            task.status = TaskStatus.CANCELLED
            task.finished_at = time.time()
            part = task.target_path + ".part"
            try:
                if os.path.exists(part):
                    os.remove(part)
            except Exception:
                pass
        return True

    def delete_task(self, task_id: str) -> bool:
        self.cancel(task_id)
        existed = task_id in self._tasks
        self._tasks.pop(task_id, None)
        self._cancel_flags.pop(task_id, None)
        return existed

    def get_task(self, task_id: str) -> DownloadTask | None:
        return self._tasks.get(task_id)

    def list_tasks(self) -> list[dict[str, Any]]:
        return [t.to_dict() for t in self._tasks.values()]

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _run(self, task_id: str) -> None:
        async with self._semaphore:
            task = self._tasks.get(task_id)
            if not task or task.status == TaskStatus.CANCELLED:
                return
            task.status = TaskStatus.DOWNLOADING
            task.started_at = time.time()
            try:
                await self._download_file(task)
                if task.status == TaskStatus.CANCELLED:
                    return
                await self._post_process(task)
                task.status = TaskStatus.DONE
                task.finished_at = time.time()
                self.cache_version += 1
                logger.info(f"[DownloadManager] {task.filename} done")
            except asyncio.CancelledError:
                task.status = TaskStatus.CANCELLED
                task.finished_at = time.time()
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error = str(exc)
                task.finished_at = time.time()
                logger.error(f"[DownloadManager] {task.filename} failed: {exc}")

    async def _download_file(self, task: DownloadTask) -> None:
        part_path = task.target_path + ".part"
        os.makedirs(os.path.dirname(task.target_path), exist_ok=True)

        headers = self._auth_headers(task.source)
        cancel_flag = self._cancel_flags[task.task_id]

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(connect=15.0, read=None, write=None, pool=15.0),
            headers=headers,
        ) as client:
            async with client.stream("GET", task.download_url) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length", 0))
                task.total_bytes = total

                downloaded = 0
                speed_window: list[tuple[float, int]] = []

                with open(part_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        if cancel_flag.is_set():
                            return
                        f.write(chunk)
                        downloaded += len(chunk)
                        task.downloaded_bytes = downloaded

                        now = time.monotonic()
                        speed_window.append((now, len(chunk)))
                        speed_window = [(t, b) for t, b in speed_window if now - t <= 3.0]
                        if len(speed_window) > 1:
                            span = speed_window[-1][0] - speed_window[0][0]
                            task.bps = sum(b for _, b in speed_window) / max(span, 0.01)

        os.replace(part_path, task.target_path)

    async def _post_process(self, task: DownloadTask) -> None:
        model_path = Path(task.target_path)
        stem = model_path.stem
        parent = model_path.parent

        if task.metadata:
            meta_path = parent / f"{stem}.metadata.json"
            try:
                meta_path.write_text(
                    json.dumps(task.metadata, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.warning(f"[DownloadManager] metadata write failed: {exc}")

        if task.preview_url:
            try:
                await self._download_preview(task.preview_url, model_path, task.source)
            except Exception as exc:
                logger.warning(f"[DownloadManager] preview download failed: {exc}")

    async def _download_preview(
        self, preview_url: str, model_path: Path, source: str
    ) -> None:
        headers = self._auth_headers(source)
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=30.0, headers=headers
        ) as client:
            resp = await client.get(preview_url)
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "")
            if "mp4" in ct:
                ext = ".mp4"
            elif "webm" in ct:
                ext = ".webm"
            elif "webp" in ct:
                ext = ".webp"
            elif "png" in ct:
                ext = ".png"
            elif "gif" in ct:
                ext = ".gif"
            else:
                ext = ".jpg"
            preview_path = model_path.parent / f"{model_path.stem}{ext}"
            preview_path.write_bytes(resp.content)
            logger.info(f"[DownloadManager] preview saved: {preview_path.name}")

    def _auth_headers(self, source: str) -> dict[str, str]:
        if source == "civitai":
            key = key_store.get_key("civitai")
            if key:
                return {"Authorization": f"Bearer {key}"}
        elif source == "huggingface":
            token = key_store.get_key("huggingface")
            if token:
                return {"Authorization": f"Bearer {token}"}
        return {}


# Singleton
download_manager = DownloadManager()
