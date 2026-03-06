/**
 * ModelCard — Grid card for a single model entry.
 *
 * Features:
 * - Lazy preview loading via IntersectionObserver (images use native loading="lazy",
 *   videos use observer so autoPlay only fires when visible)
 * - NSFW handling: hidden / blurred+icon / visible modes
 */

import { useState, useEffect, useRef } from 'react';
import { ModelEntry, previewImageUrl, formatBytes, isModelNsfw } from '../services/model-browser-service';
import type { NsfwMode } from '../store/model-browser-store';

interface ModelCardProps {
  model: ModelEntry;
  orchestratorUrl: string;
  isSelected: boolean;
  nsfwMode: NsfwMode;
  onClick: () => void;
}

export function ModelCard({ model, orchestratorUrl, isSelected, nsfwMode, onClick }: ModelCardProps) {
  const [imgError, setImgError] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nsfw = isModelNsfw(model);

  const hasPreview = Boolean(model.preview_path) && !imgError;
  const previewUrl = hasPreview ? previewImageUrl(orchestratorUrl, model.preview_path) : null;
  const isVideo = Boolean(model.preview_path.match(/\.(mp4|webm|mov)$/i));

  // IntersectionObserver for video — only set src/autoPlay when in viewport
  useEffect(() => {
    if (!isVideo || !previewUrl) return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVideoVisible(entry.isIntersecting),
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isVideo, previewUrl]);

  const baseModelBadge = (s: string) => {
    if (!s) return null;
    const label = s
      .replace('Stable Diffusion ', 'SD ')
      .replace('SDXL 1.0', 'SDXL')
      .replace(' 1.0', '');
    return label.length > 16 ? label.slice(0, 14) + '…' : label;
  };
  const badge = baseModelBadge(model.base_model);

  // Subfolder breadcrumb (show last 2 segments if present)
  const subfolderLabel = (() => {
    if (!model.subfolder || model.subfolder === '.') return null;
    const parts = model.subfolder.split(/[/\\]/).filter(Boolean);
    return parts.slice(-2).join(' / ');
  })();

  const blurred = nsfw && nsfwMode === 'blurred';

  return (
    <div
      ref={containerRef}
      className={`mb-card ${isSelected ? 'mb-card--selected' : ''} ${nsfw ? 'mb-card--nsfw' : ''}`}
      onClick={onClick}
      title={model.name}
    >
      <div className="mb-card__thumb">
        {blurred && (
          <div className="mb-card__nsfw-overlay" title="NSFW content — click to view">
            <span className="mb-card__nsfw-icon">&#128065;&#65039;&#8205;&#128683;</span>
            <span className="mb-card__nsfw-label">NSFW</span>
          </div>
        )}
        <div className={blurred ? 'mb-card__thumb-blur' : ''}>
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
              src={videoVisible ? previewUrl : undefined}
              muted
              loop
              autoPlay={videoVisible}
              playsInline
              onError={() => setImgError(true)}
            />
          )}
          {!previewUrl && (
            <div className="mb-card__placeholder">&#129504;</div>
          )}
        </div>
        {badge && <span className="mb-card__badge">{badge}</span>}
      </div>
      <div className="mb-card__info">
        <span className="mb-card__name">{model.name}</span>
        {subfolderLabel && <span className="mb-card__subfolder">{subfolderLabel}</span>}
        <span className="mb-card__size">{formatBytes(model.size_bytes)}</span>
      </div>
    </div>
  );
}
