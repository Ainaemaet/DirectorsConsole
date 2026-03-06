/**
 * ModelCard — Grid card for a single model entry.
 */

import { useState } from 'react';
import { ModelEntry, previewImageUrl, formatBytes } from '../services/model-browser-service';

interface ModelCardProps {
  model: ModelEntry;
  orchestratorUrl: string;
  isSelected: boolean;
  onClick: () => void;
}

export function ModelCard({ model, orchestratorUrl, isSelected, onClick }: ModelCardProps) {
  const [imgError, setImgError] = useState(false);

  const hasPreview = Boolean(model.preview_path) && !imgError;
  const previewUrl = hasPreview
    ? previewImageUrl(orchestratorUrl, model.preview_path)
    : null;

  // Shorten base model label for badge
  const baseModelBadge = (s: string) => {
    if (!s) return null;
    const label = s.replace('Stable Diffusion ', 'SD ')
                   .replace('SDXL 1.0', 'SDXL')
                   .replace(' 1.0', '')
                   .replace(' 1.5', ' 1.5');
    return label.length > 16 ? label.slice(0, 14) + '…' : label;
  };

  const badge = baseModelBadge(model.base_model);
  const isVideo = model.preview_path.match(/\.(mp4|webm|mov)$/i);

  return (
    <div
      className={`mb-card ${isSelected ? 'mb-card--selected' : ''}`}
      onClick={onClick}
      title={model.name}
    >
      <div className="mb-card__thumb">
        {previewUrl && !isVideo && (
          <img
            src={previewUrl}
            alt={model.name}
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
        {previewUrl && isVideo && (
          <video
            src={previewUrl}
            muted
            loop
            autoPlay
            playsInline
            onError={() => setImgError(true)}
          />
        )}
        {!previewUrl && (
          <div className="mb-card__placeholder">🧠</div>
        )}
        {badge && <span className="mb-card__badge">{badge}</span>}
      </div>
      <div className="mb-card__info">
        <span className="mb-card__name">{model.name}</span>
        <span className="mb-card__size">{formatBytes(model.size_bytes)}</span>
      </div>
    </div>
  );
}
