/**
 * ModelDetailPanel — Right slide-in panel showing full metadata for a selected model.
 */

import { useState, useEffect, useCallback } from 'react';
import { ModelEntry, ModelDetail, fetchModelDetail, previewImageUrl, formatBytes } from '../services/model-browser-service';
import { MODEL_NODE_MAP } from '../../studio/services/studio-bridge';

interface ModelDetailPanelProps {
  model: ModelEntry;
  orchestratorUrl: string;
  onClose: () => void;
}

export function ModelDetailPanel({ model, orchestratorUrl, onClose }: ModelDetailPanelProps) {
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [copiedWord, setCopiedWord] = useState<string | null>(null);

  const handleSendToStudio = useCallback(() => {
    const mapping = MODEL_NODE_MAP[model.category];
    if (!mapping) return;
    window.dispatchEvent(
      new CustomEvent('studio:add-model', {
        detail: {
          category: model.category,
          filename: model.filename,
          nodeType: mapping.nodeType,
          inputName: mapping.inputName,
        },
      })
    );
    window.dispatchEvent(new CustomEvent('app:navigate-tab', { detail: 'studio' }));
  }, [model.category, model.filename]);

  useEffect(() => {
    setDetail(null);
    setImgError(false);
    setLoadingDetail(true);
    fetchModelDetail(orchestratorUrl, model.path)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [model.path, orchestratorUrl]);

  const hasPreview = Boolean(model.preview_path) && !imgError;
  const previewUrl = hasPreview ? previewImageUrl(orchestratorUrl, model.preview_path) : null;
  const isVideo = model.preview_path.match(/\.(mp4|webm|mov)$/i);

  const copyWord = (word: string) => {
    navigator.clipboard.writeText(word).catch(() => {});
    setCopiedWord(word);
    setTimeout(() => setCopiedWord(null), 1500);
  };

  const formattedDate = model.modified
    ? new Date(model.modified * 1000).toLocaleDateString()
    : '—';

  const sha256Short = model.sha256 ? model.sha256.slice(0, 12) : '—';

  const notes = detail?.notes_md || model.notes || '';

  return (
    <div className="mb-detail">
      <div className="mb-detail__header">
        <h3 className="mb-detail__title" title={model.name}>{model.name}</h3>
        <button className="mb-detail__close" onClick={onClose} title="Close">✕</button>
      </div>

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

      {/* Core info */}
      <div className="mb-detail__meta">
        <div className="mb-detail__row">
          <span className="mb-detail__label">File</span>
          <span className="mb-detail__value mb-detail__value--mono" title={model.path}>
            {model.filename}
          </span>
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
            <span className="mb-detail__value mb-detail__value--mono" title={model.sha256}>
              {sha256Short}…
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
