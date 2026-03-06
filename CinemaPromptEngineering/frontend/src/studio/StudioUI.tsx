/**
 * StudioUI — Embedded ComfyUI tab with postMessage bridge and model sidebar.
 *
 * E1: Sidebar uses /api/model-browser/search for real-time search when a query
 *     is typed; falls back to the category model list when query is empty.
 * E2: Hovering a model row shows a floating preview popup (400 ms delay).
 * E3: Clicking the info button (⊙) on a row opens a draggable floating detail
 *     window; multiple windows can be open simultaneously.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { studioBridge, MODEL_NODE_MAP } from './services/studio-bridge';
import {
  fetchConfig,
  fetchModels,
  searchModels,
  previewImageUrl,
  formatBytes,
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

interface FloatingDetail {
  id: string;
  model: ModelEntry;
  x: number;
  y: number;
}

interface StudioUIProps {
  orchestratorUrl: string;
  comfyUiPath: string;
  isActive: boolean;
}

const STORAGE_KEY = 'studio_comfy_url';

// ── Hover Popup ──────────────────────────────────────────────────────────────

interface HoverPopupProps {
  model: ModelEntry;
  orchestratorUrl: string;
  x: number;
  y: number;
}

function HoverPopup({ model, orchestratorUrl, x, y }: HoverPopupProps) {
  return (
    <div
      className="studio-hover-popup"
      style={{ left: x, top: y, transform: 'translateY(-50%)' }}
    >
      {model.preview_path && (
        <img
          className="studio-hover-popup__thumb"
          src={previewImageUrl(orchestratorUrl, model.preview_path)}
          alt=""
        />
      )}
      <div className="studio-hover-popup__body">
        <div className="studio-hover-popup__name">{model.name}</div>
        {model.base_model && (
          <div className="studio-hover-popup__meta">{model.base_model}</div>
        )}
        <div className="studio-hover-popup__meta">{formatBytes(model.size_bytes)}</div>
        {model.tags.length > 0 && (
          <div className="studio-hover-popup__tags">
            {model.tags.slice(0, 4).map((t) => (
              <span key={t} className="studio-hover-popup__tag">{t}</span>
            ))}
          </div>
        )}
        {model.description && (
          <div className="studio-hover-popup__desc">
            {model.description.slice(0, 120)}{model.description.length > 120 ? '…' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Floating Detail Window ───────────────────────────────────────────────────

interface FloatingDetailWindowProps {
  detail: FloatingDetail;
  orchestratorUrl: string;
  canSend: boolean;
  onClose: (id: string) => void;
  onDragStart: (e: React.MouseEvent<HTMLDivElement>, id: string) => void;
  onAddNode: (model: ModelEntry) => void;
  onReplaceModel: (model: ModelEntry) => void;
}

function FloatingDetailWindow({
  detail,
  orchestratorUrl,
  canSend,
  onClose,
  onDragStart,
  onAddNode,
  onReplaceModel,
}: FloatingDetailWindowProps) {
  const { model } = detail;
  const mapping = MODEL_NODE_MAP[model.category];
  const canAction = canSend && Boolean(mapping);

  return (
    <div
      className="studio-detail-win"
      style={{ left: detail.x, top: detail.y }}
    >
      <div
        className="studio-detail-win__header"
        onMouseDown={(e) => onDragStart(e, detail.id)}
      >
        <span className="studio-detail-win__title" title={model.filename}>
          {model.name}
        </span>
        <button className="studio-detail-win__close" onClick={() => onClose(detail.id)}>
          ✕
        </button>
      </div>

      <div className="studio-detail-win__body">
        {model.preview_path && (
          <img
            className="studio-detail-win__thumb"
            src={previewImageUrl(orchestratorUrl, model.preview_path)}
            alt=""
          />
        )}

        <div className="studio-detail-win__info">
          <div className="studio-detail-win__row">
            <span className="studio-detail-win__lbl">Category</span>
            <span>{model.category}</span>
          </div>
          <div className="studio-detail-win__row">
            <span className="studio-detail-win__lbl">Base Model</span>
            <span>{model.base_model || '—'}</span>
          </div>
          <div className="studio-detail-win__row">
            <span className="studio-detail-win__lbl">Size</span>
            <span>{formatBytes(model.size_bytes)}</span>
          </div>
          {model.subfolder && (
            <div className="studio-detail-win__row">
              <span className="studio-detail-win__lbl">Subfolder</span>
              <span>{model.subfolder}</span>
            </div>
          )}
          {model.tags.length > 0 && (
            <div className="studio-detail-win__row studio-detail-win__row--wrap">
              <span className="studio-detail-win__lbl">Tags</span>
              <div className="studio-detail-win__tags">
                {model.tags.map((t) => (
                  <span key={t} className="studio-detail-win__tag">{t}</span>
                ))}
              </div>
            </div>
          )}
          {model.trained_words.length > 0 && (
            <div className="studio-detail-win__row studio-detail-win__row--wrap">
              <span className="studio-detail-win__lbl">Trigger Words</span>
              <div className="studio-detail-win__tags">
                {model.trained_words.map((w) => (
                  <span key={w} className="studio-detail-win__tag">{w}</span>
                ))}
              </div>
            </div>
          )}
          {model.description && (
            <div className="studio-detail-win__desc">{model.description}</div>
          )}
          {model.notes && (
            <div className="studio-detail-win__notes">{model.notes}</div>
          )}
        </div>

        {canAction && (
          <div className="studio-detail-win__actions">
            <button
              className="studio-detail-win__action-btn"
              onClick={() => onAddNode(model)}
            >
              + Add Node
            </button>
            <button
              className="studio-detail-win__action-btn"
              onClick={() => onReplaceModel(model)}
            >
              Replace in Graph
            </button>
          </div>
        )}
        {!mapping && (
          <div className="studio-detail-win__no-map">
            No node type mapping for category "{model.category}"
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function StudioUI({ orchestratorUrl, comfyUiPath, isActive }: StudioUIProps) {
  const [comfyUrl, setComfyUrl] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'http://127.0.0.1:8188'; }
    catch { return 'http://127.0.0.1:8188'; }
  });
  const [comfyUrlInput, setComfyUrlInput] = useState<string>(comfyUrl);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('disconnected');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pendingModelRef = useRef<PendingModel | null>(null);

  // ── Model sidebar state ─────────────────────────────────────────
  const [sidebarCategories, setSidebarCategories] = useState<string[]>([]);
  const [sidebarCategory, setSidebarCategory] = useState('');
  const [sidebarModels, setSidebarModels] = useState<ModelEntry[]>([]);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ModelEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [loadingSidebar, setLoadingSidebar] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Hover popup state ───────────────────────────────────────────
  const [hover, setHover] = useState<{ model: ModelEntry; x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Floating detail windows ─────────────────────────────────────
  const [detailWindows, setDetailWindows] = useState<FloatingDetail[]>([]);
  const detailWindowsRef = useRef<FloatingDetail[]>([]);
  useEffect(() => { detailWindowsRef.current = detailWindows; }, [detailWindows]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pollCancelRef = useRef(false);

  // ── Persist URL ─────────────────────────────────────────────────
  const applyUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    setComfyUrl(trimmed);
    setComfyUrlInput(trimmed);
    try { localStorage.setItem(STORAGE_KEY, trimmed); } catch { /* ignore */ }
    setBridgeStatus('disconnected');
  }, []);

  // ── Flush pending model once bridge is ready ────────────────────
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

  // ── Bridge event: graph-ready ───────────────────────────────────
  useEffect(() => {
    function onReady() {
      setBridgeStatus('ready');
      flushPending();
    }
    studioBridge.on('graph-ready', onReady);
    return () => studioBridge.off('graph-ready', onReady);
  }, [flushPending]);

  // ── Cross-tab: studio:add-model ─────────────────────────────────
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

  // ── Load model categories for sidebar ──────────────────────────
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

  // ── Load models for selected sidebar category ───────────────────
  useEffect(() => {
    if (!orchestratorUrl || !comfyUiPath || !sidebarCategory) return;
    setLoadingSidebar(true);
    setSelectedModel(null);
    fetchModels(orchestratorUrl, comfyUiPath, sidebarCategory)
      .then((models) => setSidebarModels(models))
      .catch(() => setSidebarModels([]))
      .finally(() => setLoadingSidebar(false));
  }, [orchestratorUrl, comfyUiPath, sidebarCategory]);

  // ── Debounced search via /api/model-browser/search ─────────────
  useEffect(() => {
    if (!sidebarSearch.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchModels(
          orchestratorUrl, comfyUiPath, sidebarSearch,
          sidebarCategory || '', 100
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [sidebarSearch, orchestratorUrl, comfyUiPath, sidebarCategory]);

  const displayModels = sidebarSearch.trim() ? searchResults : sidebarModels;
  const isLoading = loadingSidebar || isSearching;

  // ── Hover popup handlers ────────────────────────────────────────
  const onModelMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>, model: ModelEntry) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      setHover({ model, x: rect.right + 8, y: rect.top + rect.height / 2 });
    }, 400);
  }, []);

  const onModelMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHover(null);
  }, []);

  // ── Floating detail window actions ──────────────────────────────
  const openDetailWindow = useCallback((model: ModelEntry) => {
    setDetailWindows((prev) => {
      if (prev.find((w) => w.model.path === model.path)) return prev;
      return [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        model,
        x: 280 + prev.length * 24,
        y: 80 + prev.length * 24,
      }];
    });
  }, []);

  const closeDetailWindow = useCallback((id: string) => {
    setDetailWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const startDrag = useCallback((e: React.MouseEvent<HTMLDivElement>, windowId: string) => {
    e.preventDefault();
    const win = detailWindowsRef.current.find((w) => w.id === windowId);
    if (!win) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = win.x;
    const origY = win.y;

    function onMove(me: MouseEvent) {
      setDetailWindows((prev) =>
        prev.map((w) =>
          w.id === windowId
            ? { ...w, x: origX + me.clientX - startX, y: origY + me.clientY - startY }
            : w
        )
      );
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Graph actions ───────────────────────────────────────────────
  const handleAddNodeForModel = useCallback((model: ModelEntry) => {
    const mapping = MODEL_NODE_MAP[model.category];
    if (!mapping) return;
    studioBridge
      .send('add-node', {
        nodeType: mapping.nodeType,
        inputName: mapping.inputName,
        modelFilename: model.filename,
      })
      .catch(console.error);
  }, []);

  const handleReplaceModelForModel = useCallback((model: ModelEntry) => {
    const mapping = MODEL_NODE_MAP[model.category];
    if (!mapping) return;
    studioBridge
      .send('replace-model', {
        nodeType: mapping.nodeType,
        inputName: mapping.inputName,
        modelFilename: model.filename,
      })
      .catch(console.error);
  }, []);

  // Sidebar action buttons use selectedModel
  const handleAddNode = useCallback(() => {
    if (selectedModel) handleAddNodeForModel(selectedModel);
  }, [selectedModel, handleAddNodeForModel]);

  const handleReplaceModel = useCallback(() => {
    if (selectedModel) handleReplaceModelForModel(selectedModel);
  }, [selectedModel, handleReplaceModelForModel]);

  // ── Save workflow to CPE backend ────────────────────────────────
  const handleSaveWorkflow = useCallback(async () => {
    if (bridgeStatus !== 'ready') return;
    try {
      const result = await studioBridge.send<{ apiFormat: unknown; graphFormat: unknown }>('get-workflow');
      const name = prompt('Save workflow as (template name):', 'Studio Workflow');
      if (!name) return;
      const cpeBase = window.location.port === '5173' ? 'http://127.0.0.1:9800' : '';
      await fetch(`${cpeBase}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workflow: result?.apiFormat, graph: result?.graphFormat }),
      });
    } catch (err) {
      console.error('[Studio] Save workflow error:', err);
    }
  }, [bridgeStatus]);

  // ── Iframe load handler ─────────────────────────────────────────
  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    setBridgeStatus('connecting');
    studioBridge.connect(iframeRef.current, comfyUrl);

    pollCancelRef.current = false;
    const MAX_ATTEMPTS = 40;
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
      if (!pollCancelRef.current) setBridgeStatus('disconnected');
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

  // ── Derived state ───────────────────────────────────────────────
  const statusLabel = {
    disconnected: 'Bridge offline (ComfyCinemaPrompting not detected)',
    connecting: 'Connecting…',
    ready: 'Bridge ready',
  }[bridgeStatus];

  const selectedMapping = selectedModel ? MODEL_NODE_MAP[selectedModel.category] : null;
  const canSendToGraph = bridgeStatus === 'ready' && selectedModel !== null && Boolean(selectedMapping);

  return (
    <div className="studio-root">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
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

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="studio-body">
        {/* ── Model sidebar ──────────────────────────────────────── */}
        <div className={`studio-sidebar${sidebarOpen ? '' : ' studio-sidebar--collapsed'}`}>
          {sidebarOpen && (
            <>
              <div className="studio-sidebar__header">Models</div>

              <input
                className="studio-sidebar__search"
                type="text"
                placeholder="Search all models…"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
              />

              {sidebarCategories.length > 0 && (
                <>
                  <span className="studio-sidebar__cat-label">Category</span>
                  <select
                    className="studio-sidebar__cat-select"
                    value={sidebarCategory}
                    onChange={(e) => { setSidebarCategory(e.target.value); setSidebarSearch(''); }}
                  >
                    {sidebarCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </>
              )}

              <div className="studio-sidebar__model-list">
                {isLoading && (
                  <div className="studio-sidebar__empty">
                    {isSearching ? 'Searching…' : 'Loading…'}
                  </div>
                )}
                {!isLoading && displayModels.length === 0 && (
                  <div className="studio-sidebar__empty">
                    {sidebarSearch ? 'No matches.' : 'No models.'}
                  </div>
                )}
                {!isLoading && displayModels.map((m) => (
                  <div
                    key={m.path}
                    className="studio-sidebar__item-row"
                    onMouseEnter={(e) => onModelMouseEnter(e, m)}
                    onMouseLeave={onModelMouseLeave}
                  >
                    <button
                      className={`studio-sidebar__model-item${selectedModel?.path === m.path ? ' studio-sidebar__model-item--selected' : ''}`}
                      title={m.filename}
                      onClick={() => setSelectedModel((prev) => prev?.path === m.path ? null : m)}
                    >
                      {m.name}
                    </button>
                    <button
                      className="studio-sidebar__info-btn"
                      title="Show details"
                      onClick={(e) => { e.stopPropagation(); openDetailWindow(m); }}
                    >
                      ⊙
                    </button>
                  </div>
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
                      ? 'Bridge not ready'
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

        {/* ── Iframe ──────────────────────────────────────────────── */}
        <div className="studio-iframe-container">
          {!comfyUrl ? (
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
              <p className="studio-overlay__hint">URL is saved in your browser for next time.</p>
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

      {/* ── Hover popup ────────────────────────────────────────────── */}
      {hover && (
        <HoverPopup
          model={hover.model}
          orchestratorUrl={orchestratorUrl}
          x={hover.x}
          y={hover.y}
        />
      )}

      {/* ── Floating detail windows ─────────────────────────────── */}
      {detailWindows.map((detail) => (
        <FloatingDetailWindow
          key={detail.id}
          detail={detail}
          orchestratorUrl={orchestratorUrl}
          canSend={bridgeStatus === 'ready'}
          onClose={closeDetailWindow}
          onDragStart={startDrag}
          onAddNode={handleAddNodeForModel}
          onReplaceModel={handleReplaceModelForModel}
        />
      ))}
    </div>
  );
}
