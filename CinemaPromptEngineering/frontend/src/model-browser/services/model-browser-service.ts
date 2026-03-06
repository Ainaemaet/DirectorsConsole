/**
 * Model Browser Service — API client for DC's self-contained model browser endpoints.
 */

export interface ModelEntry {
  name: string;
  filename: string;
  path: string;
  category: string;
  subfolder: string;
  size_bytes: number;
  modified: number;
  base_model: string;
  sha256: string;
  preview_path: string;
  has_metadata: boolean;
  trained_words: string[];
  tags: string[];
  description: string;
  notes: string;
}

export interface ConfigResponse {
  success: boolean;
  categories: Record<string, string[]>;
  message: string;
}

export interface ModelsResponse {
  success: boolean;
  models: ModelEntry[];
  message: string;
}

export interface ModelDetail {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  notes_md: string;
  safetensors_meta: Record<string, string>;
  message: string;
}

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchConfig(
  orchestratorUrl: string,
  comfyUiPath: string
): Promise<ConfigResponse> {
  const url = `${orchestratorUrl}/api/model-browser/config?comfy_ui_path=${encodeURIComponent(comfyUiPath)}`;
  return apiGet<ConfigResponse>(url);
}

export async function fetchModels(
  orchestratorUrl: string,
  comfyUiPath: string,
  category: string
): Promise<ModelEntry[]> {
  const url =
    `${orchestratorUrl}/api/model-browser/models` +
    `?category=${encodeURIComponent(category)}` +
    `&comfy_ui_path=${encodeURIComponent(comfyUiPath)}`;
  const data = await apiGet<ModelsResponse>(url);
  return data.models ?? [];
}

export async function fetchModelDetail(
  orchestratorUrl: string,
  modelPath: string
): Promise<ModelDetail> {
  const url = `${orchestratorUrl}/api/model-browser/model-detail?model_path=${encodeURIComponent(modelPath)}`;
  return apiGet<ModelDetail>(url);
}

/** Returns the URL to use for displaying a model's preview image/video. */
export function previewImageUrl(orchestratorUrl: string, previewPath: string): string {
  return `${orchestratorUrl}/api/serve-image?path=${encodeURIComponent(previewPath)}`;
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
