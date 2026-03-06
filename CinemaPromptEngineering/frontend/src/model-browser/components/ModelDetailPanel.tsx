/**
 * ModelDetailPanel — Right slide-in panel showing full metadata for a selected model.
 *
 * Management actions:
 * - 🔍 Find on Civitai — hash lookup, writes .metadata.json, downloads preview
 * - ✏️ Edit — inline editor for name, base_model, tags, trained_words, description, notes
 * - ↗ Move / Copy — move or copy model + sidecars to another category/subfolder
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ModelEntry,
  ModelDetail,
  fetchModelDetail,
  previewImageUrl,
  formatBytes,
  fetchCivitaiMetadata,
  updateMetadata,
  moveModel,
  fetchSubfolders,
} from '../services/model-browser-service';
import { useModelBrowserStore } from '../store/model-browser-store';
import { MODEL_NODE_MAP } from '../../studio/services/studio-bridge';

interface ModelDetailPanelProps {
  model: ModelEntry;
  orchestratorUrl: string;
  comfyUiPath: string;
  onClose: () => void;
  onRefresh?: () => void;
}

export function ModelDetailPanel({
  model, orchestratorUrl, comfyUiPath, onClose, onRefresh,
}: ModelDetailPanelProps) {
  const { categories } = useModelBrowserStore();
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [copiedWord, setCopiedWord] = useState<string | null>(null);

  // ── Find on Civitai ───────────────────────────────────────────────────────
  const [civitaiStatus, setCivitaiStatus] = useState<'idle' | 'loading' | 'found' | 'notfound' | 'error'>('idle');
  const [civitaiMsg, setCivitaiMsg] = useState('');

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editBaseModel, setEditBaseModel] = useState(model.base_model);
  const [editTags, setEditTags] = useState(model.tags.join(', '));
  const [editWords, setEditWords] = useState(model.trained_words.join(', '));
  const [editDesc, setEditDesc] = useState(model.description);
  const [editNotes, setEditNotes] = useState(model.notes);
  const [editPreviewUrl, setEditPreviewUrl] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // ── Move/Copy ─────────────────────────────────────────────────────────────
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCopy, setMoveCopy] = useState(false);
  const [moveCategory, setMoveCategory] = useState(model.category);
  const [movePathIndex, setMovePathIndex] = useState(0);
  const [moveSubfolder, setMoveSubfolder] = useState('');
  const [moveSubfolderOpts, setMoveSubfolderOpts] = useState<string[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveMsg, setMoveMsg] = useState('');

  useEffect(() => {
    setDetail(null);
    setImgError(false);
    setLoadingDetail(true);
    setCivitaiStatus('idle');
    setEditOpen(false);
    setMoveOpen(false);
    setMoveMsg('');
    setEditName(model.name);
    setEditBaseModel(model.base_model);
    setEditTags(model.tags.join(', '));
    setEditWords(model.trained_words.join(', '));
    setEditDesc(model.description);
    setEditNotes(model.notes);
    fetchModelDetail(orchestratorUrl, model.path)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [model.path, orchestratorUrl]);

  useEffect(() => {
    if (!moveCategory || !comfyUiPath || !orchestratorUrl) return;
    fetchSubfolders(orchestratorUrl, comfyUiPath, moveCategory)
      .then(setMoveSubfolderOpts)
      .catch(() => setMoveSubfolderOpts([]));
  }, [moveCategory, comfyUiPath, orchestratorUrl]);

  const handleSendToStudio = useCallback(() => {
    const mapping = MODEL_NODE_MAP[model.category];
    if (!mapping) return;
    window.dispatchEvent(new CustomEvent('studio:add-model', {
      detail: { category: model.category, filename: model.filename, nodeType: mapping.nodeType, inputName: mapping.inputName },
    }));
    window.dispatchEvent(new CustomEvent('app:navigate-tab', { detail: 'studio' }));
  }, [model.category, model.filename]);

  const handleFindOnCivitai = async () => {
    setCivitaiStatus('loading');
    setCivitaiMsg('');
    try {
      const result = await fetchCivitaiMetadata(orchestratorUrl, model.path, false);
      if (result.found) {
        setCivitaiStatus('found');
        setCivitaiMsg('Metadata found and saved! Refresh to see updates.');
        onRefresh?.();
      } else {
        setCivitaiStatus('notfound');
        setCivitaiMsg(`Not found on Civitai (SHA256: ${result.sha256?.slice(0, 12)}…)`);
      }
    } catch (e) {
      setCivitaiStatus('error');
      setCivitaiMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      await updateMetadata(orchestratorUrl, model.path, {
        model_name: editName,
        base_model: editBaseModel,
        tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
        trained_words: editWords.split(',').map((w) => w.trim()).filter(Boolean),
        description: editDesc,
        notes: editNotes,
      }, editPreviewUrl || undefined);
      setEditOpen(false);
      onRefresh?.();
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEditSaving(false);
    }
  };

  const handleMove = async () => {
    if (!moveCategory) return;
    setMoveBusy(true);
    setMoveMsg('');
    try {
      const result = await moveModel(orchestratorUrl, {
        model_path: model.path,
        new_category: moveCategory,
        new_path_index: movePathIndex,
        new_subfolder: moveSubfolder,
        copy: moveCopy,
        comfy_ui_path: comfyUiPath,
      });
      setMoveMsg(result.moved ? `${moveCopy ? 'Copied' : 'Moved'} to ${result.new_path}` : (result.message ?? 'Already in that location'));
      if (result.moved) onRefresh?.();
    } catch (e) {
      setMoveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMoveBusy(false);
    }
  };

  const hasPreview = Boolean(model.preview_path) && !imgError;
  const previewUrl = hasPreview ? previewImageUrl(orchestratorUrl, model.preview_path) : null;
  const isVideo = model.preview_path.match(/\.(mp4|webm|mov)$/i);
  const formattedDate = model.modified ? new Date(model.modified * 1000).toLocaleDateString() : '—';
  const sha256Short = model.sha256 ? model.sha256.slice(0, 12) : '—';
  const notes = detail?.notes_md || model.notes || '';
  const categoryNames = Object.keys(categories).sort();

  const copyWord = (word: string) => {
    navigator.clipboard.writeText(word).catch(() => {});
    setCopiedWord(word);
    setTimeout(() => setCopiedWord(null), 1500);
  };

  return (
    <div className="mb-detail">
      <div className="mb-detail__header">
        <h3 className="mb-detail__title" title={model.name}>{model.name}</h3>
        <div className="mb-detail__header-actions">
          <button
            className="mb-detail__action-btn"
            title="Find metadata on Civitai by file hash"
            onClick={handleFindOnCivitai}
            disabled={civitaiStatus === 'loading'}
          >
            {civitaiStatus === 'loading' ? '…' : '🔍'}
          </button>
          <button
            className={`mb-detail__action-btn ${editOpen ? 'mb-detail__action-btn--active' : ''}`}
            title="Edit metadata"
            onClick={() => setEditOpen(!editOpen)}
          >
            ✏️
          </button>
          <button
            className={`mb-detail__action-btn ${moveOpen ? 'mb-detail__action-btn--active' : ''}`}
            title="Move or copy model"
            onClick={() => setMoveOpen(!moveOpen)}
          >
            ↗
          </button>
          <button className="mb-detail__close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* Civitai status */}
      {civitaiStatus !== 'idle' && civitaiStatus !== 'loading' && (
        <div className={`mb-detail__status-bar mb-detail__status-bar--${civitaiStatus}`}>
          {civitaiMsg}
        </div>
      )}

      {/* Preview */}
      <div className="mb-detail__preview">
        {previewUrl && !isVideo && (
          <img src={previewUrl} alt={model.name} onError={() => setImgError(true)} />
        )}
        {previewUrl && isVideo && (
          <video src={previewUrl} muted loop autoPlay playsInline onError={() => setImgError(true)} />
        )}
        {!previewUrl && (
          <div className="mb-detail__preview-placeholder">🧠</div>
        )}
      </div>

      {/* Edit metadata form */}
      {editOpen && (
        <div className="mb-detail__edit">
          <div className="mb-detail__edit-row">
            <label>Display Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="mb-detail__edit-row">
            <label>Base Model</label>
            <input value={editBaseModel} onChange={(e) => setEditBaseModel(e.target.value)} placeholder="e.g. Flux.1 D" />
          </div>
          <div className="mb-detail__edit-row">
            <label>Tags (comma-separated)</label>
            <input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
          </div>
          <div className="mb-detail__edit-row">
            <label>Trigger Words (comma-separated)</label>
            <input value={editWords} onChange={(e) => setEditWords(e.target.value)} />
          </div>
          <div className="mb-detail__edit-row">
            <label>Description</label>
            <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} />
          </div>
          <div className="mb-detail__edit-row">
            <label>Notes</label>
            <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
          </div>
          <div className="mb-detail__edit-row">
            <label>Preview URL (download &amp; save)</label>
            <input value={editPreviewUrl} onChange={(e) => setEditPreviewUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="mb-detail__edit-actions">
            <button className="mb-detail__edit-save" onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </button>
            <button className="mb-detail__edit-cancel" onClick={() => setEditOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Move / Copy form */}
      {moveOpen && (
        <div className="mb-detail__edit">
          <div className="mb-detail__edit-row mb-detail__edit-row--inline">
            <label>
              <input type="radio" checked={!moveCopy} onChange={() => setMoveCopy(false)} /> Move
            </label>
            <label>
              <input type="radio" checked={moveCopy} onChange={() => setMoveCopy(true)} /> Copy
            </label>
          </div>
          <div className="mb-detail__edit-row">
            <label>Category</label>
            <select value={moveCategory} onChange={(e) => { setMoveCategory(e.target.value); setMovePathIndex(0); }}>
              {categoryNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {moveCategory && (categories[moveCategory] ?? []).length > 1 && (
            <div className="mb-detail__edit-row">
              <label>Base path</label>
              <select value={movePathIndex} onChange={(e) => setMovePathIndex(Number(e.target.value))}>
                {(categories[moveCategory] ?? []).map((p, i) => (
                  <option key={i} value={i}>{p}</option>
                ))}
              </select>
            </div>
          )}
          <div className="mb-detail__edit-row">
            <label>Subfolder (optional)</label>
            <input
              list="mb-detail-subfolder-list"
              value={moveSubfolder}
              onChange={(e) => setMoveSubfolder(e.target.value)}
              placeholder="e.g. style/portraits"
            />
            <datalist id="mb-detail-subfolder-list">
              {moveSubfolderOpts.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          {moveMsg && (
            <div className="mb-detail__edit-msg">{moveMsg}</div>
          )}
          <div className="mb-detail__edit-actions">
            <button className="mb-detail__edit-save" onClick={handleMove} disabled={moveBusy || !moveCategory}>
              {moveBusy ? 'Working…' : moveCopy ? 'Copy' : 'Move'}
            </button>
            <button className="mb-detail__edit-cancel" onClick={() => setMoveOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Core info */}
      <div className="mb-detail__meta">
        <div className="mb-detail__row">
          <span className="mb-detail__label">File</span>
          <span className="mb-detail__value mb-detail__value--mono" title={model.path}>{model.filename}</span>
        </div>
        {model.subfolder && (
          <div className="mb-detail__row">
            <span className="mb-detail__label">Folder</span>
            <span className="mb-detail__value mb-detail__value--mono">{model.subfolder}</span>
          </div>
        )}
        {model.base_model && (
          <div className="mb-detail__row">
            <span className="mb-detail__label">Base model</span>
            <span className="mb-detail__value">{model.base_model}</span>
          </div>
        )}
        <div className="mb-detail__row">
          <span className="mb-detail__label">Size</span>
          <span className="mb-detail__value">{formatBytes(model.size_bytes)}</span>
        </div>
        <div className="mb-detail__row">
          <span className="mb-detail__label">Modified</span>
          <span className="mb-detail__value">{formattedDate}</span>
        </div>
        {model.sha256 && (
          <div className="mb-detail__row">
            <span className="mb-detail__label">SHA256</span>
            <span className="mb-detail__value mb-detail__value--mono" title={model.sha256}>{sha256Short}…</span>
          </div>
        )}
        {!model.has_metadata && (
          <div className="mb-detail__row">
            <span className="mb-detail__label">Metadata</span>
            <span className="mb-detail__value" style={{ color: 'var(--mb-text-muted)', fontStyle: 'italic' }}>
              None — click 🔍 to search Civitai
            </span>
          </div>
        )}
      </div>

      {/* Trained words */}
      {model.trained_words.length > 0 && (
        <div className="mb-detail__section">
          <h4 className="mb-detail__section-title">Trigger Words</h4>
          <div className="mb-detail__chips">
            {model.trained_words.map((w) => (
              <button
                key={w}
                className={`mb-detail__chip ${copiedWord === w ? 'mb-detail__chip--copied' : ''}`}
                onClick={() => copyWord(w)}
                title="Click to copy"
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {model.tags.length > 0 && (
        <div className="mb-detail__section">
          <h4 className="mb-detail__section-title">Tags</h4>
          <div className="mb-detail__chips mb-detail__chips--tags">
            {model.tags.slice(0, 30).map((t) => (
              <span key={t} className="mb-detail__tag">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {model.description && (
        <div className="mb-detail__section">
          <h4 className="mb-detail__section-title">Description</h4>
          <p className="mb-detail__description">{model.description}</p>
        </div>
      )}

      {/* Notes */}
      {loadingDetail && (
        <div className="mb-detail__section">
          <span className="mb-detail__loading">Loading details…</span>
        </div>
      )}
      {notes && (
        <div className="mb-detail__section">
          <h4 className="mb-detail__section-title">Notes</h4>
          <pre className="mb-detail__notes">{notes}</pre>
        </div>
      )}

      {/* Safetensors metadata */}
      {detail && Object.keys(detail.safetensors_meta).length > 0 && (
        <div className="mb-detail__section">
          <h4 className="mb-detail__section-title">Embedded Metadata</h4>
          <div className="mb-detail__st-meta">
            {Object.entries(detail.safetensors_meta).map(([k, v]) => (
              <div key={k} className="mb-detail__st-row">
                <span className="mb-detail__st-key">{k}</span>
                <span className="mb-detail__st-val">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Studio actions */}
      {MODEL_NODE_MAP[model.category] && (
        <div className="mb-detail__section mb-detail__studio-actions">
          <button
            className="mb-detail__chip"
            onClick={handleSendToStudio}
            title="Add a loader node for this model in the Studio tab"
          >
            Send to Studio ↗
          </button>
        </div>
      )}
    </div>
  );
}
