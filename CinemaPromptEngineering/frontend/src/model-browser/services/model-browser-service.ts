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

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResponse {
  success: boolean;
  models: ModelEntry[];
  message: string;
}

export async function searchModels(
  orchestratorUrl: string,
  comfyUiPath: string,
  query: string,
  categories = '',
  limit = 200
): Promise<ModelEntry[]> {
  const url =
    `${orchestratorUrl}/api/model-browser/search` +
    `?q=${encodeURIComponent(query)}` +
    `&comfy_ui_path=${encodeURIComponent(comfyUiPath)}` +
    (categories ? `&categories=${encodeURIComponent(categories)}` : '') +
    `&limit=${limit}`;
  const data = await apiGet<SearchResponse>(url);
  return data.models ?? [];
}

// ── Downloads ─────────────────────────────────────────────────────────────────

export interface DownloadTask {
  task_id: string;
  filename: string;
  target_path: string;
  source: string;
  status: 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled';
  downloaded_bytes: number;
  total_bytes: number;
  bps: number;
  error: string;
  progress: number;
}

export async function listDownloadTasks(orchestratorUrl: string): Promise<DownloadTask[]> {
  const data = await apiGet<{ tasks: DownloadTask[] }>(`${orchestratorUrl}/api/downloads`);
  return data.tasks ?? [];
}

export async function startCivitaiDownload(
  orchestratorUrl: string,
  payload: {
    filename: string;
    target_path: string;
    download_url: string;
    preview_url?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>;
  }
): Promise<string> {
  const resp = await fetch(`${orchestratorUrl}/api/downloads/civitai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { task_id: string };
  return data.task_id;
}

export async function startHuggingFaceDownload(
  orchestratorUrl: string,
  payload: { repo_id: string; filename: string; target_path: string; hf_subfolder?: string }
): Promise<string> {
  const resp = await fetch(`${orchestratorUrl}/api/downloads/huggingface`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { task_id: string };
  return data.task_id;
}

export async function cancelDownload(orchestratorUrl: string, taskId: string): Promise<void> {
  await fetch(`${orchestratorUrl}/api/downloads/${taskId}`, { method: 'DELETE' });
}

export async function removeDownload(orchestratorUrl: string, taskId: string): Promise<void> {
  await fetch(`${orchestratorUrl}/api/downloads/${taskId}/remove`, { method: 'DELETE' });
}

// ── Discover — keys ───────────────────────────────────────────────────────────

export interface ApiKeys { civitai: string; huggingface: string; }

export async function getApiKeys(orchestratorUrl: string): Promise<ApiKeys> {
  return apiGet<ApiKeys>(`${orchestratorUrl}/api/discover/keys`);
}

export async function setApiKey(
  orchestratorUrl: string,
  platform: 'civitai' | 'huggingface',
  value: string
): Promise<void> {
  const resp = await fetch(`${orchestratorUrl}/api/discover/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, value }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function deleteApiKey(
  orchestratorUrl: string,
  platform: 'civitai' | 'huggingface'
): Promise<void> {
  await fetch(`${orchestratorUrl}/api/discover/keys/${platform}`, { method: 'DELETE' });
}

// ── Discover — Civitai ────────────────────────────────────────────────────────

export interface CivitaiModel {
  id: number;
  name: string;
  type: string;
  nsfw: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelVersions: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  creator: any;
  stats: { downloadCount: number; favoriteCount: number; rating: number; ratingCount: number };
  tags: string[];
}

export interface CivitaiSearchResult {
  items: CivitaiModel[];
  metadata: { totalItems?: number; nextCursor?: string; currentPage?: number };
}

export async function civitaiSearch(
  orchestratorUrl: string,
  params: {
    query?: string;
    types?: string;
    sort?: string;
    period?: string;
    baseModels?: string;
    nsfw?: boolean;
    limit?: number;
    cursor?: string;
  }
): Promise<CivitaiSearchResult> {
  const p = new URLSearchParams();
  if (params.query)      p.set('query', params.query);
  if (params.types)      p.set('types', params.types);
  if (params.sort)       p.set('sort', params.sort);
  if (params.period)     p.set('period', params.period);
  if (params.baseModels) p.set('base_models', params.baseModels);
  if (params.nsfw != null) p.set('nsfw', String(params.nsfw));
  if (params.limit)      p.set('limit', String(params.limit));
  if (params.cursor)     p.set('cursor', params.cursor);
  return apiGet<CivitaiSearchResult>(`${orchestratorUrl}/api/discover/civitai/models?${p}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function civitaiModelDetail(orchestratorUrl: string, modelId: number): Promise<any> {
  return apiGet(`${orchestratorUrl}/api/discover/civitai/models/${modelId}`);
}

// ── Discover — HuggingFace ────────────────────────────────────────────────────

export interface HFModel {
  id: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export async function hfSearch(
  orchestratorUrl: string,
  params: { query?: string; filter?: string; sort?: string; limit?: number; cursor?: string }
): Promise<HFModel[]> {
  const p = new URLSearchParams();
  if (params.query)  p.set('query', params.query);
  if (params.filter) p.set('filter', params.filter);
  if (params.sort)   p.set('sort', params.sort);
  if (params.limit)  p.set('limit', String(params.limit));
  if (params.cursor) p.set('cursor', params.cursor);
  return apiGet<HFModel[]>(`${orchestratorUrl}/api/discover/huggingface/models?${p}`);
}

export interface HFModelFiles {
  model_id: string;
  downloads: number;
  likes: number;
  tags: string[];
  siblings: { filename: string; size: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  card_data: Record<string, any>;
}

export async function hfModelFiles(orchestratorUrl: string, repoId: string): Promise<HFModelFiles> {
  return apiGet(`${orchestratorUrl}/api/discover/huggingface/models/${repoId}/files`);
}

// ── NSFW helpers ──────────────────────────────────────────────────────────────

/** Returns true if the model lives inside a .nsfw subfolder. */
export function isModelNsfw(model: ModelEntry): boolean {
  const combined = model.subfolder + '/' + model.path;
  return combined.split(/[/\\]/).some((seg) => seg.toLowerCase() === '.nsfw');
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
