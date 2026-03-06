"""Secure API key storage for Director's Console.

Keys are stored as a pickle-serialised dict, XOR-obfuscated with a
machine-derived seed (SHA-256 of the system's UUID/hostname).  This is
the same approach used by ComfyUI-Model-Manager: not cryptographically
unbreakable, but the binary file is not readable as plain text and is
stored outside the git repo.

Usage:
    from orchestrator.api.key_store import get_key, set_key, mask_key
"""

from __future__ import annotations

import hashlib
import pickle
import uuid
from pathlib import Path

_DATA_DIR = Path(__file__).parent.parent / "data"
_KEY_FILE = _DATA_DIR / "api_keys.key"


def _machine_seed() -> bytes:
    """Return a 32-byte seed derived from the machine's hardware UUID."""
    try:
        node = str(uuid.getnode()).encode()
    except Exception:
        node = b"dc-orchestrator-fallback"
    return hashlib.sha256(node).digest()


def _obfuscate(data: bytes) -> bytes:
    seed = _machine_seed()
    return bytes(b ^ seed[i % len(seed)] for i, b in enumerate(data))


def _load() -> dict[str, str]:
    if not _KEY_FILE.exists():
        return {}
    try:
        return pickle.loads(_obfuscate(_KEY_FILE.read_bytes()))
    except Exception:
        return {}


def _save(keys: dict[str, str]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_bytes(_obfuscate(pickle.dumps(keys)))


def get_key(name: str) -> str | None:
    return _load().get(name)


def set_key(name: str, value: str | None) -> None:
    keys = _load()
    if value:
        keys[name] = value
    else:
        keys.pop(name, None)
    _save(keys)


def mask_key(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return value[:4] + "****" + value[-4:]


def get_masked_all() -> dict[str, str]:
    return {k: mask_key(v) for k, v in _load().items()}
