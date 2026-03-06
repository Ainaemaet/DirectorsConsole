/**
 * StudioUI — Embedded ComfyUI tab with postMessage bridge and model sidebar.
 *
 * The bridge extension (dc_bridge.js) is loaded automatically by ComfyUI when
 * ComfyCinemaPrompting is installed. Bridge status is shown in the toolbar so
 * users know immediately whether programmatic control is available.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { studioBridge, MODEL_NODE_MAP } from './services/studio-bridge';
import {
  fetchConfig,
  fetchModels,
  type ModelEntry,
} from '../model-browser/services/model-browser-service';
import './StudioUI.css';

type BridgeStatus = 'disconnected' | 'connecting' | 'ready';

interface PendingModel {
  category: string;
  filename: string;
  nodeType: string;
  inputName: string;
}

interface StudioUIProps {
  orchestratorUrl: string;
  comfyUiPath: string;
  isActive: boolean;
}

const STORAGE_KEY = 'studio_comfy_url';

export function StudioUI({ orchestratorUrl, comfyUiPath, isActive }: StudioUIProps) {
  const [comfyUrl, setComfyUrl] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'http://127.0.0.1:8188'; } catch { return 'http://127.0.0.1:8188'; }
  });
  const [comfyUrlInput, setComfyUrlInput] = useState<string>(comfyUrl);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('disconnected');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pendingModelRef = useRef<PendingModel | null>(null);

  // Model sidebar state
  const [sidebarCategories, setSidebarCategories] = useState<string[]>([]);
  const [sidebarCategory, setSidebarCategory] = useState('');
  const [sidebarModels, setSidebarModels] = useState<ModelEntry[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [loadingSidebar, setLoadingSidebar] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pollCancelRef = useRef(false);

  // ── Persist URL ────────────────────────────────────────────────
  const applyUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    setComfyUrl(trimmed);
    setComfyUrlInput(trimmed);
    try { localStorage.setItem(STORAGE_KEY, trimmed); } catch { /* ignore */ }
    setBridgeStatus('disconnected');
  }, []);

  // ── Flush pending model once bridge is ready ───────────────────
  const flushPending = useCallback(() => {
    const pending = pendingModelRef.current;
    if (pending) {
      pendingModelRef.current = null;
      studioBridge
        .send('add-node', {
          nodeType: pending.nodeType,
          inputName: pending.inputName,
          modelFilename: pending.filename,
        })
        .catch(console.error);
    }
  }, []);

  // ── Bridge event: graph-ready (handles ComfyUI-side reloads) ──
  useEffect(() => {
    function onReady() {
      setBridgeStatus('ready');
      flushPending();
    }
    studioBridge.on('graph-ready', onReady);
    return () => studioBridge.off('graph-ready', onReady);
  }, [flushPending]);

  // ── Cross-tab: studio:add-model ────────────────────────────────
  useEffect(() => {
    function onAddModel(e: Event) {
      const { category, filename, nodeType, inputName } = (e as CustomEvent<PendingModel>).detail;
      if (bridgeStatus === 'ready') {
        studioBridge
          .send('add-node', { nodeType, inputName, modelFilename: filename })
          .catch(console.error);
      } else {
        pendingModelRef.current = { category, filename, nodeType, inputName };
      }
    }
    window.addEventListener('studio:add-model', onAddModel);
    return () => window.removeEventListener('studio:add-model', onAddModel);
  }, [bridgeStatus]);

  // ── Load model categories for sidebar ─────────────────────────
  useEffect(() => {
    if (!isActive || !orchestratorUrl || !comfyUiPath) return;
    fetchConfig(orchestratorUrl, comfyUiPath)
      .then((cfg) => {
        const cats = Object.keys(cfg.categories).sort();
        setSidebarCategories(cats);
        if (cats.length > 0 && !sidebarCategory) setSidebarCategory(cats[0]);
      })
      .catch(() => {});
  }, [isActive, orchestratorUrl, comfyUiPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load models for selected sidebar category ──────────────────
  useEffect(() => {
    if (!orchestratorUrl || !comfyUiPath || !sidebarCategory) return;
    setLoadingSidebar(true);
    setSelectedModel(null);
    fetchModels(orchestratorUrl, comfyUiPath, sidebarCategory)
      .then((models) => setSidebarModels(models))
      .catch(() => setSidebarModels([]))
      .finally(() => setLoadingSidebar(false));
  }, [orchestratorUrl, comfyUiPath, sidebarCategory]);

  // ── Filtered models ────────────────────────────────────────────
  const displayModels = useMemo(() => {
    if (!sidebarSearch.trim()) return sidebarModels;
    const q = sidebarSearch.toLowerCase();
    return sidebarModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.filename.toLowerCase().includes(q)
    );
  }, [sidebarModels, sidebarSearch]);

  // ── Iframe load handler — connect then poll for bridge ─────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    setBridgeStatus('connecting');
    studioBridge.connect(iframeRef.current, comfyUrl);

    // Poll for bridge readiness. The bridge sends graph-ready during ComfyUI's
    // startup, which fires BEFORE DC's onLoad listener is registered — so the
    // one-shot event is lost. We probe with ping until the bridge responds.
    pollCancelRef.current = false;
    const MAX_ATTEMPTS = 40; // ~60 seconds total (1.5s gap)
    const GAP_MS = 1500;

    async function poll() {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        if (pollCancelRef.current) return;
        await new Promise<void>((r) => setTimeout(r, GAP_MS));
        if (pollCancelRef.current) return;
        try {
          await studioBridge.send('ping', {}, 2000);
          if (!pollCancelRef.current) {
            setBridgeStatus('ready');
            flushPending();
          }
          return;
        } catch {
          // not ready yet — keep trying
        }
      }
      // Timed out — ComfyCinemaPrompting likely not installed
      if (!pollCancelRef.current) {
        setBridgeStatus('disconnected');
      }
    }

    poll();
  }, [comfyUrl, flushPending]);

  // ── Cancel poll + disconnect bridge when URL changes/unmounts ──
  useEffect(() => {
    return () => {
      pollCancelRef.current = true;
      studioBridge.disconnect();
    };
  }, [comfyUrl]);

  // ── Add node action ────────────────────────────────────────────
  const handleAddNode = useCallback(() => {
    if (!selectedModel) return;
    const mapping = MODEL_NODE_MAP[selectedModel.category];
    if (!mapping) return;
    studioBridge
      .send('add-node', {
        nodeType: mapping.nodeType,
        inputName: mapping.inputName,
        modelFilename: selectedModel.filename,
      })
      .catch(console.error);
  }, [selectedModel]);

  // ── Replace in graph action ────────────────────────────────────
  const handleReplaceModel = useCallback(() => {
    if (!selectedModel) return;
    const mapping = MODEL_NODE_MAP[selectedModel.category];
    if (!mapping) return;
    studioBridge
      .send('replace-model', {
        nodeType: mapping.nodeType,
        inputName: mapping.inputName,
        modelFilename: selectedModel.filename,
      })
      .catch(console.error);
  }, [selectedModel]);

  // ── Save workflow to CPE backend ───────────────────────────────
  const handleSaveWorkflow = useCallback(async () => {
    if (bridgeStatus !== 'ready') return;
    try {
      const result = await studioBridge.send<{ apiFormat: unknown; graphFormat: unknown }>('get-workflow');
      const name = prompt('Save workflow as (template name):', 'Studio Workflow');
      if (!name) return;
      // POST to CPE backend — endpoint accepts workflow + graph fields
      const cpeBase = window.location.port === '5173'
        ? 'http://127.0.0.1:9800'
        : '';
      await fetch(`${cpeBase}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workflow: result?.apiFormat, graph: result?.graphFormat }),
      });
    } catch (err) {
      console.error('[Studio] Save workflow error:', err);
    }
  }, [bridgeStatus]);

  // ── Status display ─────────────────────────────────────────────
  const statusLabel = {
    disconnected: 'Bridge offline (ComfyCinemaPrompting not detected)',
    connecting:   'Connecting…',
    ready:        'Bridge ready',
  }[bridgeStatus];

  const selectedMapping = selectedModel ? MODEL_NODE_MAP[selectedModel.category] : null;
  const canSendToGraph = bridgeStatus === 'ready' && selectedModel && Boolean(selectedMapping);

  const showOverlay = !comfyUrl;

  return (
    <div className="studio-root">
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="studio-toolbar">
        <button
          className="studio-toolbar__collapse"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Collapse model panel' : 'Expand model panel'}
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>

        <span className="studio-toolbar__url-label">ComfyUI:</span>
        <input
          className="studio-toolbar__url-input"
          type="text"
          value={comfyUrlInput}
          onChange={(e) => setComfyUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyUrl(comfyUrlInput); }}
          placeholder="http://127.0.0.1:8188"
        />
        <button className="studio-toolbar__url-go" onClick={() => applyUrl(comfyUrlInput)}>
          Go
        </button>

        <div className="studio-toolbar__status">
          <span className={`studio-toolbar__status-dot studio-toolbar__status-dot--${bridgeStatus}`} />
          {statusLabel}
        </div>

        <div className="studio-toolbar__spacer" />

        <button
          className="studio-toolbar__btn"
          onClick={handleSaveWorkflow}
          disabled={bridgeStatus !== 'ready'}
          title="Save current ComfyUI graph as a DC template"
        >
          Save to DC
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="studio-body">
        {/* ── Model sidebar ──────────────────────────────────── */}
        <div className={`studio-sidebar${sidebarOpen ? '' : ' studio-sidebar--collapsed'}`}>
          {sidebarOpen && (
            <>
              <div className="studio-sidebar__header">Models</div>

              <input
                className="studio-sidebar__search"
                type="text"
                placeholder="Filter models…"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
              />

              {sidebarCategories.length > 0 && (
                <>
                  <span className="studio-sidebar__cat-label">Category</span>
                  <select
                    className="studio-sidebar__cat-select"
                    value={sidebarCategory}
                    onChange={(e) => setSidebarCategory(e.target.value)}
                  >
                    {sidebarCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </>
              )}

              <div className="studio-sidebar__model-list">
                {loadingSidebar && (
                  <div className="studio-sidebar__empty">Loading…</div>
                )}
                {!loadingSidebar && displayModels.length === 0 && (
                  <div className="studio-sidebar__empty">
                    {sidebarSearch ? 'No matches.' : 'No models.'}
                  </div>
                )}
                {!loadingSidebar && displayModels.map((m) => (
                  <button
                    key={m.path}
                    className={`studio-sidebar__model-item${selectedModel?.path === m.path ? ' studio-sidebar__model-item--selected' : ''}`}
                    title={m.filename}
                    onClick={() => setSelectedModel((prev) => prev?.path === m.path ? null : m)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>

              <div className="studio-sidebar__actions">
                <button
                  className="studio-sidebar__action-btn"
                  disabled={!canSendToGraph}
                  onClick={handleAddNode}
                  title={
                    !selectedModel
                      ? 'Select a model first'
                      : !selectedMapping
                      ? 'No node type mapping for this category'
                      : bridgeStatus !== 'ready'
                      ? 'Bridge not ready — open Studio with ComfyCinemaPrompting installed'
                      : 'Add a loader node for this model'
                  }
                >
                  + Add Node
                </button>
                <button
                  className="studio-sidebar__action-btn"
                  disabled={!canSendToGraph}
                  onClick={handleReplaceModel}
                  title="Replace existing loader node's model, or add if none found"
                >
                  Replace in Graph
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Iframe ─────────────────────────────────────────── */}
        <div className="studio-iframe-container">
          {showOverlay ? (
            <div className="studio-overlay">
              <div className="studio-overlay__icon">🎛️</div>
              <h2 className="studio-overlay__title">Studio</h2>
              <p className="studio-overlay__text">
                Enter your ComfyUI URL to embed it here. The DC bridge extension activates
                automatically when ComfyCinemaPrompting is installed.
              </p>
              <div className="studio-overlay__url-row">
                <input
                  className="studio-overlay__url-input"
                  type="text"
                  placeholder="http://127.0.0.1:8188"
                  value={comfyUrlInput}
                  onChange={(e) => setComfyUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyUrl(comfyUrlInput); }}
                />
                <button className="studio-overlay__connect-btn" onClick={() => applyUrl(comfyUrlInput)}>
                  Connect
                </button>
              </div>
              <p className="studio-overlay__hint">
                URL is saved in your browser for next time.
              </p>
            </div>
          ) : (
            <iframe
              key={comfyUrl}
              ref={iframeRef}
              className="studio-iframe"
              src={comfyUrl}
              title="ComfyUI Studio"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>
      </div>
    </div>
  );
}
