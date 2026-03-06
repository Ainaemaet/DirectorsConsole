/**
 * DiscoverPanel — Browse and download models from Civitai and HuggingFace.
 *
 * State is local to this component (no need to survive tab switches).
 * Downloads are handed off to the Orchestrator which tracks them globally.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  civitaiSearch,
  civitaiModelDetail,
  hfSearch,
  hfModelFiles,
  getApiKeys,
  setApiKey,
  deleteApiKey,
  startCivitaiDownload,
  startHuggingFaceDownload,
  fetchSubfolders,
  fetchCivitaiBaseModels,
  formatBytes,
  type CivitaiModel,
  type HFModel,
  type HFModelFiles,
} from '../services/model-browser-service';
import { useModelBrowserStore } from '../store/model-browser-store';

interface DiscoverPanelProps {
  orchestratorUrl: string;
  comfyUiPath: string;
  /** Category → base path list (from config) */
  categories: Record<string, string[]>;
}

type Source = 'civitai' | 'huggingface';

const CIVITAI_TYPES = [
  'Checkpoint', 'LORA', 'LoCon', 'DoRA', 'Controlnet',
  'TextualInversion', 'VAE', 'Upscaler', 'Hypernetwork',
  'MotionModule', 'Wildcards', 'Workflows', 'Poses', 'Other',
];
const CIVITAI_SORTS = ['Most Downloaded', 'Highest Rated', 'Newest', 'Most Discussed', 'Most Collected', 'Most Buzz'];
const CIVITAI_PERIODS = ['AllTime', 'Year', 'Month', 'Week', 'Day'];
// Compact static fallback — the full list is fetched dynamically from the backend
const CIVITAI_BASE_MODELS_STATIC = [
  'Flux.1 D', 'Flux.1 S', 'Flux.1 Dev', 'Flux.1 Schnell', 'FLUX Klein',
  'SD 1.5', 'SDXL 1.0', 'Pony', 'Illustrious', 'NoobAI',
  'SD 3', 'SD 3.5', 'SD 3.5 Large', 'SD 3.5 Medium',
  'HunyuanVideo', 'Wan Video', 'LTX-Video', 'CogVideoX', 'Mochi',
];
const HF_FILTERS = [
  '', 'text-to-image', 'image-to-image', 'text-to-video',
  'image-to-video', 'text-to-3d', 'lora',
];

// Maps Civitai model type → DC category name (best-effort)
const CIVITAI_TYPE_TO_CATEGORY: Record<string, string> = {
  Checkpoint: 'checkpoints',
  LORA: 'loras',
  LoCon: 'loras',
  DoRA: 'loras',
  Controlnet: 'controlnet',
  VAE: 'vae',
  Upscaler: 'upscale_models',
  TextualInversion: 'embeddings',
};

export function DiscoverPanel({ orchestratorUrl, comfyUiPath, categories }: DiscoverPanelProps) {
  const { addDownloadTask, nsfwMode } = useModelBrowserStore();

  // ── Dynamic base models ───────────────────────────────────────────────────
  const [baseModels, setBaseModels] = useState<string[]>(CIVITAI_BASE_MODELS_STATIC);
  useEffect(() => {
    if (!orchestratorUrl) return;
    fetchCivitaiBaseModels(orchestratorUrl)
      .then((list) => { if (list.length > 0) setBaseModels(list); })
      .catch(() => {});
  }, [orchestratorUrl]);

  const [source, setSource] = useState<Source>('civitai');

  // ── API keys ──────────────────────────────────────────────────────────────
  const [civitaiKey, setCivitaiKey] = useState('');
  const [hfKey, setHfKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [editingKey, setEditingKey] = useState<Source | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    if (!orchestratorUrl) return;
    getApiKeys(orchestratorUrl).then((k) => {
      setCivitaiKey(k.civitai);
      setHfKey(k.huggingface);
    }).catch(() => {});
  }, [orchestratorUrl]);

  const saveKey = useCallback(async () => {
    if (!editingKey) return;
    await setApiKey(orchestratorUrl, editingKey, keyInput);
    if (editingKey === 'civitai') setCivitaiKey(keyInput.slice(0, 4) + '****' + keyInput.slice(-4));
    else setHfKey(keyInput.slice(0, 4) + '****' + keyInput.slice(-4));
    setEditingKey(null);
    setKeyInput('');
  }, [editingKey, keyInput, orchestratorUrl]);

  const removeKey = useCallback(async (platform: Source) => {
    await deleteApiKey(orchestratorUrl, platform);
    if (platform === 'civitai') setCivitaiKey('');
    else setHfKey('');
  }, [orchestratorUrl]);

  // ── Civitai state ─────────────────────────────────────────────────────────
  const [cvQuery, setCvQuery] = useState('');
  const [cvType, setCvType] = useState('');
  const [cvSort, setCvSort] = useState('Most Downloaded');
  const [cvPeriod, setCvPeriod] = useState('AllTime');
  const [cvBaseModel, setCvBaseModel] = useState('');
  const [cvNsfw, setCvNsfw] = useState(false);
  const [cvResults, setCvResults] = useState<CivitaiModel[]>([]);
  const [cvCursor, setCvCursor] = useState('');
  const [cvHasMore, setCvHasMore] = useState(false);
  const [cvLoading, setCvLoading] = useState(false);
  const [cvError, setCvError] = useState('');
  const [cvSelected, setCvSelected] = useState<CivitaiModel | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cvDetail, setCvDetail] = useState<any | null>(null);
  const [cvDetailLoading, setCvDetailLoading] = useState(false);
  const [cvSelectedVersion, setCvSelectedVersion] = useState(0); // index into modelVersions

  const searchCivitai = useCallback(async (append = false) => {
    if (!orchestratorUrl) return;
    setCvLoading(true);
    setCvError('');
    try {
      const result = await civitaiSearch(orchestratorUrl, {
        query: cvQuery,
        types: cvType,
        sort: cvSort,
        period: cvPeriod,
        baseModels: cvBaseModel,
        nsfw: cvNsfw,
        limit: 20,
        cursor: append ? cvCursor : '',
      });
      setCvResults((prev) => append ? [...prev, ...(result.items ?? [])] : (result.items ?? []));
      setCvCursor(result.metadata?.nextCursor ?? '');
      setCvHasMore(Boolean(result.metadata?.nextCursor));
    } catch (e) {
      setCvError(e instanceof Error ? e.message : String(e));
    } finally {
      setCvLoading(false);
    }
  }, [orchestratorUrl, cvQuery, cvType, cvSort, cvPeriod, cvBaseModel, cvNsfw, cvCursor]);

  // Load detail when a civitai card is clicked
  useEffect(() => {
    if (!cvSelected || !orchestratorUrl) return;
    setCvDetail(null);
    setCvDetailLoading(true);
    setCvSelectedVersion(0);
    civitaiModelDetail(orchestratorUrl, cvSelected.id)
      .then((d) => setCvDetail(d))
      .catch(() => setCvDetail(null))
      .finally(() => setCvDetailLoading(false));
  }, [cvSelected, orchestratorUrl]);

  // ── HuggingFace state ─────────────────────────────────────────────────────
  const [hfQuery, setHfQuery] = useState('');
  const [hfFilter, setHfFilter] = useState('');
  const [hfResults, setHfResults] = useState<HFModel[]>([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [hfError, setHfError] = useState('');
  const [hfSelected, setHfSelected] = useState<HFModel | null>(null);
  const [hfFiles, setHfFiles] = useState<HFModelFiles | null>(null);
  const [hfFilesLoading, setHfFilesLoading] = useState(false);

  const searchHF = useCallback(async () => {
    if (!orchestratorUrl) return;
    setHfLoading(true);
    setHfError('');
    try {
      const results = await hfSearch(orchestratorUrl, {
        query: hfQuery,
        filter: hfFilter,
        limit: 20,
      });
      setHfResults(Array.isArray(results) ? results : []);
    } catch (e) {
      setHfError(e instanceof Error ? e.message : String(e));
    } finally {
      setHfLoading(false);
    }
  }, [orchestratorUrl, hfQuery, hfFilter]);

  useEffect(() => {
    if (!hfSelected || !orchestratorUrl) return;
    setHfFiles(null);
    setHfFilesLoading(true);
    const repoId = hfSelected.modelId || hfSelected.id;
    hfModelFiles(orchestratorUrl, repoId)
      .then((f) => setHfFiles(f))
      .catch(() => setHfFiles(null))
      .finally(() => setHfFilesLoading(false));
  }, [hfSelected, orchestratorUrl]);

  // ── Download target state ─────────────────────────────────────────────────
  const [dlCategory, setDlCategory] = useState('');
  const [dlPathIndex, setDlPathIndex] = useState(0);
  const [dlSubfolder, setDlSubfolder] = useState('');
  const [dlBusy, setDlBusy] = useState(false);
  const [dlSubfolderOptions, setDlSubfolderOptions] = useState<string[]>([]);

  // Fetch existing subfolders when category changes
  useEffect(() => {
    if (!dlCategory || !orchestratorUrl) { setDlSubfolderOptions([]); return; }
    // Find a comfy_ui_path from the first available base path
    // We only need it to resolve extra_model_paths.yaml — use a dummy approach:
    // pass first base path's parent directories up until we find extra_model_paths.yaml
    // For simplicity, derive from categories prop (paths are absolute)
    if (!comfyUiPath) return;
    fetchSubfolders(orchestratorUrl, comfyUiPath, dlCategory)
      .then(setDlSubfolderOptions)
      .catch(() => setDlSubfolderOptions([]));
  }, [dlCategory, orchestratorUrl, comfyUiPath]);

  // Auto-suggest category from Civitai model type
  useEffect(() => {
    if (!cvSelected) return;
    const suggested = CIVITAI_TYPE_TO_CATEGORY[cvSelected.type] ?? '';
    if (suggested && categories[suggested]) setDlCategory(suggested);
  }, [cvSelected, categories]);

  const resolveTargetPath = (filename: string) => {
    const basePaths = categories[dlCategory] ?? [];
    const base = basePaths[dlPathIndex] ?? basePaths[0] ?? '';
    const sub = dlSubfolder.trim().replace(/^[/\\]+|[/\\]+$/g, '');
    return [base, sub, filename].filter(Boolean).join('/');
  };

  // ── Civitai download ──────────────────────────────────────────────────────
  const downloadCivitai = useCallback(async (fileObj: { name: string; downloadUrl: string; sizeKB: number }, previewUrl: string) => {
    if (!dlCategory || !orchestratorUrl) return;
    setDlBusy(true);
    try {
      const filename = fileObj.name;
      const target_path = resolveTargetPath(filename);
      // Build compact metadata from detail
      const metadata = cvDetail ? {
        model_name: cvDetail.name,
        model_id: cvDetail.id,
        model_type: cvDetail.type,
        base_model: cvDetail.modelVersions?.[cvSelectedVersion]?.baseModel ?? '',
        trained_words: cvDetail.modelVersions?.[cvSelectedVersion]?.trainedWords ?? [],
        tags: cvDetail.tags ?? [],
        description: cvDetail.description ?? '',
        civitai: {
          modelId: cvDetail.id,
          modelVersionId: cvDetail.modelVersions?.[cvSelectedVersion]?.id,
          baseModel: cvDetail.modelVersions?.[cvSelectedVersion]?.baseModel ?? '',
          trainedWords: cvDetail.modelVersions?.[cvSelectedVersion]?.trainedWords ?? [],
          model: { name: cvDetail.name, tags: cvDetail.tags ?? [] },
        },
      } : {};

      const taskId = await startCivitaiDownload(orchestratorUrl, {
        filename,
        target_path,
        download_url: fileObj.downloadUrl,
        preview_url: previewUrl,
        metadata,
      });
      addDownloadTask({
        task_id: taskId,
        filename,
        target_path,
        source: 'civitai',
        status: 'queued',
        downloaded_bytes: 0,
        total_bytes: fileObj.sizeKB * 1024,
        bps: 0,
        error: '',
        progress: 0,
      });
    } catch (e) {
      alert(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDlBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestratorUrl, dlCategory, dlPathIndex, dlSubfolder, cvDetail, cvSelectedVersion, addDownloadTask]);

  // ── HF download ───────────────────────────────────────────────────────────
  const downloadHF = useCallback(async (file: { filename: string; size: number }) => {
    if (!dlCategory || !orchestratorUrl || !hfSelected) return;
    setDlBusy(true);
    try {
      const repoId = hfSelected.modelId || hfSelected.id;
      const target_path = resolveTargetPath(file.filename.split('/').pop()!);
      const taskId = await startHuggingFaceDownload(orchestratorUrl, {
        repo_id: repoId,
        filename: file.filename,
        target_path,
      });
      addDownloadTask({
        task_id: taskId,
        filename: file.filename.split('/').pop()!,
        target_path,
        source: 'huggingface',
        status: 'queued',
        downloaded_bytes: 0,
        total_bytes: file.size,
        bps: 0,
        error: '',
        progress: 0,
      });
    } catch (e) {
      alert(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDlBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestratorUrl, dlCategory, dlPathIndex, dlSubfolder, hfSelected, addDownloadTask]);

  const categoryNames = Object.keys(categories).sort();

  // ── Civitai detail sidebar ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderCivitaiDetail = (detail: any) => {
    const versions = detail.modelVersions ?? [];
    const ver = versions[cvSelectedVersion];
    const files = ver?.files ?? [];
    const images = ver?.images ?? [];
    const previewUrl = images[0]?.url ?? '';
    const earlyAccessEndsAt = ver?.earlyAccessEndsAt ?? ver?.earlyAccess?.endsAt ?? '';
    const isEarlyAccess = earlyAccessEndsAt && new Date(earlyAccessEndsAt) > new Date();

    return (
      <div className="disc-detail">
        <div className="disc-detail__header">
          <h3>{detail.name}</h3>
          <span className="disc-detail__type">{detail.type}</span>
        </div>
        {previewUrl && (
          <img className="disc-detail__preview" src={previewUrl} alt={detail.name} loading="lazy" />
        )}
        <div className="disc-detail__stats">
          <span>{detail.stats?.downloadCount?.toLocaleString() ?? 0} downloads</span>
          <span>{detail.stats?.rating?.toFixed(1) ?? '—'} &#9733; ({detail.stats?.ratingCount ?? 0})</span>
        </div>
        {isEarlyAccess && (
          <div className="disc-detail__early-access">
            🔒 Early Access — ends {new Date(earlyAccessEndsAt).toLocaleDateString()}
            <br /><small>May require a Civitai membership to download.</small>
          </div>
        )}
        {versions.length > 1 && (
          <div className="disc-detail__row">
            <label className="disc-detail__label">Version</label>
            <select
              className="disc-detail__select"
              value={cvSelectedVersion}
              onChange={(e) => setCvSelectedVersion(Number(e.target.value))}
            >
              {versions.map((v: { name: string }, i: number) => (
                <option key={i} value={i}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="disc-detail__dl-target">
          <label className="disc-detail__label">Save to</label>
          <select
            className="disc-detail__select"
            value={dlCategory}
            onChange={(e) => { setDlCategory(e.target.value); setDlPathIndex(0); }}
          >
            <option value="">— choose category —</option>
            {categoryNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {dlCategory && (categories[dlCategory] ?? []).length > 1 && (
            <select
              className="disc-detail__select"
              value={dlPathIndex}
              onChange={(e) => setDlPathIndex(Number(e.target.value))}
            >
              {(categories[dlCategory] ?? []).map((p, i) => (
                <option key={i} value={i}>{p}</option>
              ))}
            </select>
          )}
          <input
            className="disc-detail__input"
            type="text"
            list="disc-subfolder-list"
            placeholder="subfolder (optional)"
            value={dlSubfolder}
            onChange={(e) => setDlSubfolder(e.target.value)}
          />
          <datalist id="disc-subfolder-list">
            {dlSubfolderOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="disc-detail__files">
          {files.map((f: { name: string; downloadUrl: string; sizeKB: number; primary?: boolean }, i: number) => (
            <div key={i} className="disc-detail__file">
              <span className="disc-detail__filename">{f.name}</span>
              <span className="disc-detail__filesize">{formatBytes((f.sizeKB ?? 0) * 1024)}</span>
              <button
                className="disc-detail__dl-btn"
                disabled={!dlCategory || dlBusy}
                onClick={() => downloadCivitai(f, previewUrl)}
              >
                {dlBusy ? '…' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderHFDetail = (files: HFModelFiles) => {
    const repoId = hfSelected ? (hfSelected.modelId || hfSelected.id) : '';
    return (
      <div className="disc-detail">
        <div className="disc-detail__header">
          <h3>{repoId}</h3>
        </div>
        <div className="disc-detail__stats">
          <span>{files.downloads?.toLocaleString() ?? 0} downloads</span>
          <span>{files.likes ?? 0} &#10084;</span>
        </div>
        <div className="disc-detail__dl-target">
          <label className="disc-detail__label">Save to</label>
          <select
            className="disc-detail__select"
            value={dlCategory}
            onChange={(e) => { setDlCategory(e.target.value); setDlPathIndex(0); }}
          >
            <option value="">— choose category —</option>
            {categoryNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {dlCategory && (categories[dlCategory] ?? []).length > 1 && (
            <select
              className="disc-detail__select"
              value={dlPathIndex}
              onChange={(e) => setDlPathIndex(Number(e.target.value))}
            >
              {(categories[dlCategory] ?? []).map((p, i) => (
                <option key={i} value={i}>{p}</option>
              ))}
            </select>
          )}
          <input
            className="disc-detail__input"
            type="text"
            list="disc-subfolder-list"
            placeholder="subfolder (optional)"
            value={dlSubfolder}
            onChange={(e) => setDlSubfolder(e.target.value)}
          />
          <datalist id="disc-subfolder-list">
            {dlSubfolderOptions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="disc-detail__files">
          {files.siblings.map((f, i) => (
            <div key={i} className="disc-detail__file">
              <span className="disc-detail__filename">{f.filename.split('/').pop()}</span>
              {f.size > 0 && <span className="disc-detail__filesize">{formatBytes(f.size)}</span>}
              <button
                className="disc-detail__dl-btn"
                disabled={!dlCategory || dlBusy}
                onClick={() => downloadHF(f)}
              >
                {dlBusy ? '…' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="disc-root">
      {/* ── Source toggle + API key settings ──────────────────────── */}
      <div className="disc-header">
        <div className="disc-source-tabs">
          <button className={`disc-source-tab ${source === 'civitai' ? 'active' : ''}`} onClick={() => setSource('civitai')}>Civitai</button>
          <button className={`disc-source-tab ${source === 'huggingface' ? 'active' : ''}`} onClick={() => setSource('huggingface')}>HuggingFace</button>
        </div>
        <button className="disc-key-btn" onClick={() => setShowKeys(!showKeys)} title="API key settings">
          &#128273; Keys
        </button>
      </div>

      {/* ── API key settings panel ──────────────────────────────── */}
      {showKeys && (
        <div className="disc-keys">
          {(['civitai', 'huggingface'] as const).map((platform) => {
            const current = platform === 'civitai' ? civitaiKey : hfKey;
            return (
              <div key={platform} className="disc-key-row">
                <span className="disc-key-label">{platform === 'civitai' ? 'Civitai' : 'HuggingFace'}</span>
                {editingKey === platform ? (
                  <>
                    <input
                      className="disc-key-input"
                      type="password"
                      placeholder={`Paste ${platform} API key…`}
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      autoFocus
                    />
                    <button className="disc-key-save" onClick={saveKey}>Save</button>
                    <button className="disc-key-cancel" onClick={() => { setEditingKey(null); setKeyInput(''); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="disc-key-masked">{current || '(not set)'}</span>
                    <button className="disc-key-edit" onClick={() => { setEditingKey(platform); setKeyInput(''); }}>Edit</button>
                    {current && <button className="disc-key-del" onClick={() => removeKey(platform)}>Remove</button>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="disc-body">
        {/* ── Left: search + results ──────────────────────────────── */}
        <div className="disc-list">
          {source === 'civitai' ? (
            <>
              <div className="disc-filters">
                <input className="disc-search" type="text" placeholder="Search Civitai…"
                  value={cvQuery} onChange={(e) => setCvQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchCivitai()} />
                <select className="disc-select" value={cvType} onChange={(e) => setCvType(e.target.value)}>
                  <option value="">All types</option>
                  {CIVITAI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="disc-select" value={cvBaseModel} onChange={(e) => setCvBaseModel(e.target.value)}>
                  <option value="">All bases</option>
                  {baseModels.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <select className="disc-select" value={cvSort} onChange={(e) => setCvSort(e.target.value)}>
                  {CIVITAI_SORTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="disc-select" value={cvPeriod} onChange={(e) => setCvPeriod(e.target.value)}>
                  {CIVITAI_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label className="disc-nsfw-toggle" title="Include NSFW results from Civitai">
                  <input type="checkbox" checked={cvNsfw} onChange={(e) => setCvNsfw(e.target.checked)} />
                  NSFW
                </label>
                <button className="disc-search-btn" onClick={() => searchCivitai()} disabled={cvLoading}>
                  {cvLoading ? '…' : 'Search'}
                </button>
              </div>
              {cvError && <div className="disc-error">{cvError}</div>}
              <div className="disc-cards">
                {cvResults
                  .filter((m) => {
                    if (!m.nsfw) return true;
                    if (nsfwMode === 'hidden') return false;
                    return true; // blurred/visible/only-nsfw all show
                  })
                  .map((m) => (
                    <CivitaiCard
                      key={m.id}
                      model={m}
                      selected={cvSelected?.id === m.id}
                      nsfwMode={nsfwMode}
                      onClick={() => setCvSelected(cvSelected?.id === m.id ? null : m)}
                    />
                  ))}
                {cvResults.length === 0 && !cvLoading && (
                  <div className="disc-empty">Search Civitai to discover models.</div>
                )}
              </div>
              {cvHasMore && (
                <button className="disc-load-more" onClick={() => searchCivitai(true)} disabled={cvLoading}>
                  {cvLoading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="disc-filters">
                <input className="disc-search" type="text" placeholder="Search HuggingFace…"
                  value={hfQuery} onChange={(e) => setHfQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchHF()} />
                <select className="disc-select" value={hfFilter} onChange={(e) => setHfFilter(e.target.value)}>
                  {HF_FILTERS.map((f) => <option key={f} value={f}>{f || 'All types'}</option>)}
                </select>
                <button className="disc-search-btn" onClick={searchHF} disabled={hfLoading}>
                  {hfLoading ? '…' : 'Search'}
                </button>
              </div>
              {hfError && <div className="disc-error">{hfError}</div>}
              <div className="disc-cards">
                {hfResults.map((m) => {
                  const id = m.modelId || m.id;
                  return (
                    <div
                      key={id}
                      className={`disc-hf-card ${hfSelected && (hfSelected.modelId || hfSelected.id) === id ? 'disc-hf-card--selected' : ''}`}
                      onClick={() => setHfSelected(hfSelected && (hfSelected.modelId || hfSelected.id) === id ? null : m)}
                    >
                      <span className="disc-hf-card__name">{id}</span>
                      <span className="disc-hf-card__stats">{m.downloads?.toLocaleString() ?? 0} downloads</span>
                      {m.tags?.slice(0, 3).map((t: string) => (
                        <span key={t} className="disc-hf-card__tag">{t}</span>
                      ))}
                    </div>
                  );
                })}
                {hfResults.length === 0 && !hfLoading && (
                  <div className="disc-empty">Search HuggingFace to discover models.</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Right: detail / download panel ─────────────────────── */}
        <div className="disc-detail-pane">
          {source === 'civitai' && cvSelected && (
            cvDetailLoading
              ? <div className="disc-detail-loading">Loading…</div>
              : cvDetail && renderCivitaiDetail(cvDetail)
          )}
          {source === 'huggingface' && hfSelected && (
            hfFilesLoading
              ? <div className="disc-detail-loading">Loading files…</div>
              : hfFiles && renderHFDetail(hfFiles)
          )}
          {((source === 'civitai' && !cvSelected) || (source === 'huggingface' && !hfSelected)) && (
            <div className="disc-detail-empty">Select a model to see details and download options.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small Civitai card ─────────────────────────────────────────────────────────

function CivitaiCard({ model, selected, nsfwMode, onClick }: {
  model: CivitaiModel;
  selected: boolean;
  nsfwMode: string;
  onClick: () => void;
}) {
  const ver = model.modelVersions?.[0];
  const thumb = ver?.images?.[0]?.url ?? '';
  const [imgErr, setImgErr] = useState(false);
  const blurred = model.nsfw && nsfwMode === 'blurred';

  return (
    <div className={`disc-cv-card ${selected ? 'disc-cv-card--selected' : ''} ${model.nsfw ? 'disc-cv-card--nsfw' : ''}`} onClick={onClick}>
      <div className="disc-cv-card__thumb">
        {blurred && (
          <div className="disc-cv-card__nsfw-overlay">
            <span>🔞</span>
          </div>
        )}
        <div className={blurred ? 'disc-cv-card__thumb-blur' : ''}>
          {thumb && !imgErr
            ? <img src={thumb} alt={model.name} loading="lazy" onError={() => setImgErr(true)} />
            : <div className="disc-cv-card__placeholder">&#129504;</div>
          }
        </div>
        <span className="disc-cv-card__type">{model.type}</span>
        {model.nsfw && <span className="disc-cv-card__nsfw-badge">NSFW</span>}
      </div>
      <div className="disc-cv-card__info">
        <span className="disc-cv-card__name">{model.name}</span>
        <span className="disc-cv-card__stats">{model.stats?.downloadCount?.toLocaleString() ?? 0} dl</span>
      </div>
    </div>
  );
}
