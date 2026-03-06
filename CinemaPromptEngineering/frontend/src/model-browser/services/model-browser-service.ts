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
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'failed' | 'cancelled';
  priority?: number;
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

export async function pauseDownload(orchestratorUrl: string, taskId: string): Promise<void> {
  const resp = await fetch(`${orchestratorUrl}/api/downloads/${taskId}/pause`, { method: 'POST' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function resumeDownload(orchestratorUrl: string, taskId: string): Promise<void> {
  const resp = await fetch(`${orchestratorUrl}/api/downloads/${taskId}/resume`, { method: 'POST' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function setDownloadPriority(orchestratorUrl: string, taskId: string, priority: number): Promise<void> {
  const resp = await fetch(`${orchestratorUrl}/api/downloads/${taskId}/priority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function setMaxConcurrent(orchestratorUrl: string, maxConcurrent: number): Promise<void> {
  await fetch(`${orchestratorUrl}/api/downloads/settings/max-concurrent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_concurrent: maxConcurrent }),
  });
}

// ── Model management ──────────────────────────────────────────────────────────

export interface MoveRequest {
  model_path: string;
  new_category: string;
  new_path_index: number;
  new_subfolder: string;
  copy: boolean;
  comfy_ui_path: string;
}

export async function moveModel(orchestratorUrl: string, req: MoveRequest): Promise<{ moved: boolean; new_path?: string; message?: string }> {
  const resp = await fetch(`${orchestratorUrl}/api/model-browser/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export async function updateMetadata(
  orchestratorUrl: string,
  modelPath: string,
  fields: Record<string, unknown>,
  previewUrl?: string
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${orchestratorUrl}/api/model-browser/metadata`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_path: modelPath, fields, preview_url: previewUrl ?? '' }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export async function fetchCivitaiMetadata(
  orchestratorUrl: string,
  modelPath: string,
  overwrite = false
): Promise<{ found: boolean; sha256?: string; metadata?: Record<string, unknown>; preview_path?: string }> {
  const resp = await fetch(`${orchestratorUrl}/api/model-browser/fetch-civitai-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_path: modelPath, overwrite }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
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

export async function fetchSubfolders(
  orchestratorUrl: string,
  comfyUiPath: string,
  category: string
): Promise<string[]> {
  const url =
    `${orchestratorUrl}/api/model-browser/subfolders` +
    `?category=${encodeURIComponent(category)}` +
    `&comfy_ui_path=${encodeURIComponent(comfyUiPath)}`;
  const data = await apiGet<{ subfolders: string[] }>(url);
  return data.subfolders ?? [];
}

export async function fetchCivitaiBaseModels(orchestratorUrl: string): Promise<string[]> {
  const data = await apiGet<{ base_models: string[] }>(
    `${orchestratorUrl}/api/discover/civitai/base-models`
  );
  return data.base_models ?? [];
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
