# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Director's Console** (Project Eliot) is a unified AI VFX production pipeline. It combines three main services:

1. **CinemaPromptEngineering (CPE)** — Cinema rules engine + FastAPI backend + React/TypeScript frontend
2. **Orchestrator** — Distributed render farm manager for ComfyUI nodes
3. **Gallery** — Full media browser, built as a top-level React tab with its own Zustand store and 23 backend endpoints

## Build & Run Commands

### Start All Services
```bash
python start.py           # Primary launcher
python start.py --setup   # Verify/setup environments
```

### CPE Backend (port 9800)
```bash
cd CinemaPromptEngineering
python -m uvicorn api.main:app --host 0.0.0.0 --port 9800 --reload
```

### CPE Frontend (port 5173)
```bash
cd CinemaPromptEngineering/frontend
npm install
npm run dev              # Dev server
npm run build            # Production build
npm run build:standalone # Standalone mode
npm run build:comfyui    # ComfyUI node build
npm run lint             # ESLint (--max-warnings 0)
```

### Orchestrator (port 9820)
```bash
cd Orchestrator
python -m uvicorn orchestrator.api:app --host 0.0.0.0 --port 9820 --reload
```
Note: `orchestrator/api/__init__.py` re-exports `app` from `orchestrator/api/server.py`.

## Testing
```bash
# All tests
python -m pytest tests/ -v

# Individual test files
python -m pytest tests/test_cpe_api.py -v
python -m pytest tests/test_cinema_rules.py -v
python -m pytest tests/test_path_translator.py -v   # 38 path translation tests
```

## Architecture

### Service Communication
```
CPE Frontend (React) → ComfyUI nodes DIRECTLY (not through Orchestrator)
CPE Frontend (React) → CPE Backend (port 9800) for proxy ops (image read, delete, LLM)
CPE Frontend (React) → Orchestrator (port 9820) for job groups, backends, gallery, projects
```

**Critical**: The frontend sends ComfyUI workflows and WebSocket connections directly to ComfyUI nodes (e.g., `http://192.168.x.x:8188`). The Orchestrator does NOT proxy ComfyUI execution. File DELETE requires the CPE backend proxy (`/api/delete-file`) because CORS blocks direct browser DELETE requests.

### Gallery ↔ Storyboard Cross-Tab Communication
These two tabs run as siblings in the same browser window and communicate via `window` CustomEvents:
- `gallery:request-image-params` / `gallery:image-params-response` — fetch generation params from Storyboard
- `gallery:send-reference-image` — send image to Storyboard as reference input
- `gallery:restore-workflow-from-metadata` — restore full workflow + params from PNG metadata
- `gallery:files-renamed` — sync renamed files back to Storyboard panel image history

### Gallery Storage
Gallery metadata is stored as JSON at `{projectPath}/.gallery/gallery.json` (NOT SQLite). SQLite is incompatible with CIFS/SMB NAS mounts. All writes use atomic write (temp file + rename).

### Panel System (Canvas)
Each canvas panel holds:
- `workflowId` — links to a specific workflow config
- `parameterValues` — panel-specific parameters (NOT global)
- `imageHistory` — stack of generated images/videos with navigation
- `status`, `progressPhase`, `progressNodeName`, `parallelJobs` — generation state

When switching workflows on a panel, only preserve prompt and image inputs; reset everything else to workflow defaults.

### Path Translation
Cross-platform path mappings (Windows ↔ Linux ↔ macOS) are managed by `Orchestrator/orchestrator/path_translator.py`, saved to `Orchestrator/orchestrator/data/path_mappings.json`. All 13 path-consuming Orchestrator endpoints call `_translate_path()` before filesystem operations.

## Key File Locations

| What | Where |
|---|---|
| CPE API main | `CinemaPromptEngineering/api/main.py` |
| CPE LLM providers | `CinemaPromptEngineering/api/providers/` |
| Orchestrator API server | `Orchestrator/orchestrator/api/server.py` |
| Gallery API (23 endpoints) | `Orchestrator/orchestrator/api/gallery_routes.py` |
| Gallery JSON store | `Orchestrator/orchestrator/gallery_db.py` |
| Path translator | `Orchestrator/orchestrator/path_translator.py` |
| StoryboardUI (main React) | `CinemaPromptEngineering/frontend/src/storyboard/StoryboardUI.tsx` |
| ComfyUI WebSocket | `CinemaPromptEngineering/frontend/src/storyboard/services/comfyui-websocket.ts` |
| ComfyUI client | `CinemaPromptEngineering/frontend/src/storyboard/services/comfyui-client.ts` |
| Workflow parser | `CinemaPromptEngineering/frontend/src/storyboard/services/workflow-parser.ts` |
| Gallery main UI | `CinemaPromptEngineering/frontend/src/gallery/GalleryUI.tsx` |
| Gallery Zustand store | `CinemaPromptEngineering/frontend/src/gallery/store/gallery-store.ts` |
| Gallery API client | `CinemaPromptEngineering/frontend/src/gallery/services/gallery-service.ts` |
| Cinema rules engine | `CinemaPromptEngineering/cinema_rules/` |
| Film presets | `CinemaPromptEngineering/cinema_rules/presets/live_action.py` |

**Warning**: `CinemaPromptEngineering/ComfyCinemaPrompting/cinema_rules/` is a DUPLICATE — always use the top-level `cinema_rules/` module.

## Technology Stack

- **Backend**: Python 3.10+, FastAPI, Pydantic v2, asyncio/httpx, loguru
- **Frontend**: React 18, TypeScript 5, Vite 5, Zustand, TanStack Query v5, Lucide icons, `@dnd-kit`

## Code Style

**Python**: mandatory type hints, Google-style docstrings, `async/await` for all I/O, loguru for logging, never silent failures.

**TypeScript/React**: strict TypeScript, function declarations (not const arrows), Zustand for global state, React Query for server state.

## Adding New Film Presets
1. Add to `CinemaPromptEngineering/cinema_rules/presets/live_action.py`
2. Add cinematography style to `cinematography_styles.py`
3. Run `python -m pytest tests/test_presets.py -v`
4. Verify with `python CinemaPromptEngineering/audit_presets.py`

## Known Architectural Issues
- `StoryboardUI.tsx` is a 7,100+ line monolithic component — be cautious with large edits
- No authentication on API endpoints (local-only use assumed)
- Duplicate `cinema_rules/` directories
- 24MB frontend bundle with no code splitting
