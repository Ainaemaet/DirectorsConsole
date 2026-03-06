/**
 * Zustand store for the Model Browser tab.
 */

import { create } from 'zustand';
import {
  ModelEntry,
  DownloadTask,
  fetchConfig,
  fetchModels,
  listDownloadTasks,
  cancelDownload,
  removeDownload,
  pauseDownload,
  resumeDownload,
  setDownloadPriority,
} from '../services/model-browser-service';

export type NsfwMode = 'hidden' | 'blurred' | 'visible' | 'only-nsfw';
export type ActiveView = 'library' | 'discover';

function loadNsfwMode(): NsfwMode {
  try {
    const v = localStorage.getItem('mb_nsfw_mode');
    if (v === 'blurred' || v === 'visible' || v === 'only-nsfw') return v;
  } catch { /* ignore */ }
  return 'hidden';
}

function loadCardSize(): number {
  try {
    const v = localStorage.getItem('mb_card_size');
    if (v) {
      const n = parseInt(v, 10);
      if (n >= 100 && n <= 400) return n;
    }
  } catch { /* ignore */ }
  return 160;
}

interface ModelBrowserStore {
  // Config
  categories: Record<string, string[]>;
  selectedCategory: string;
  isLoadingConfig: boolean;

  // Models
  models: ModelEntry[];
  isLoadingModels: boolean;
  loadedCategory: string;

  // Selection
  selectedModel: ModelEntry | null;

  // Filtering / sorting
  searchQuery: string;
  sortBy: 'name' | 'size' | 'modified';
  sortDir: 'asc' | 'desc';

  // Error
  error: string | null;

  // View
  activeView: ActiveView;

  // NSFW
  nsfwMode: NsfwMode;

  // Card size (px)
  cardSize: number;

  // Download queue
  downloadTasks: DownloadTask[];
  downloadDrawerOpen: boolean;

  // Actions
  setSelectedCategory: (cat: string) => void;
  setSelectedModel: (model: ModelEntry | null) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (field: 'name' | 'size' | 'modified') => void;
  setSortDir: (dir: 'asc' | 'desc') => void;
  clearError: () => void;
  setActiveView: (v: ActiveView) => void;
  setNsfwMode: (m: NsfwMode) => void;
  setCardSize: (size: number) => void;
  setDownloadDrawerOpen: (open: boolean) => void;

  // Async
  loadConfig: (orchestratorUrl: string, comfyUiPath: string) => Promise<void>;
  loadModels: (orchestratorUrl: string, comfyUiPath: string, category: string) => Promise<void>;

  // Downloads
  addDownloadTask: (task: DownloadTask) => void;
  updateDownloadTask: (taskId: string, updates: Partial<DownloadTask>) => void;
  syncDownloadTasks: (orchestratorUrl: string) => Promise<void>;
  cancelTask: (orchestratorUrl: string, taskId: string) => Promise<void>;
  removeTask: (orchestratorUrl: string, taskId: string) => Promise<void>;
  pauseTask: (orchestratorUrl: string, taskId: string) => Promise<void>;
  resumeTask: (orchestratorUrl: string, taskId: string) => Promise<void>;
  bumpPriority: (orchestratorUrl: string, taskId: string) => Promise<void>;
  lowerPriority: (orchestratorUrl: string, taskId: string) => Promise<void>;
}

export const useModelBrowserStore = create<ModelBrowserStore>((set, get) => ({
  categories: {},
  selectedCategory: '',
  isLoadingConfig: false,

  models: [],
  isLoadingModels: false,
  loadedCategory: '__none__',

  selectedModel: null,

  searchQuery: '',
  sortBy: 'name',
  sortDir: 'asc',

  error: null,

  activeView: 'library',
  nsfwMode: loadNsfwMode(),
  cardSize: loadCardSize(),

  downloadTasks: [],
  downloadDrawerOpen: false,

  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortBy: (field) => set({ sortBy: field }),
  setSortDir: (dir) => set({ sortDir: dir }),
  clearError: () => set({ error: null }),
  setActiveView: (v) => set({ activeView: v }),
  setNsfwMode: (m) => {
    try { localStorage.setItem('mb_nsfw_mode', m); } catch { /* ignore */ }
    set({ nsfwMode: m });
  },
  setCardSize: (size) => {
    try { localStorage.setItem('mb_card_size', String(size)); } catch { /* ignore */ }
    set({ cardSize: size });
  },
  setDownloadDrawerOpen: (open) => set({ downloadDrawerOpen: open }),

  loadConfig: async (orchestratorUrl, comfyUiPath) => {
    if (!orchestratorUrl || !comfyUiPath) return;
    set({ isLoadingConfig: true, error: null });
    try {
      const data = await fetchConfig(orchestratorUrl, comfyUiPath);
      set({ categories: data.categories, isLoadingConfig: false });
    } catch (err) {
      set({
        isLoadingConfig: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadModels: async (orchestratorUrl, comfyUiPath, category) => {
    if (!orchestratorUrl || !comfyUiPath) return;
    const { loadedCategory } = get();
    if (loadedCategory === category) return;
    set({ isLoadingModels: true, error: null, models: [], selectedModel: null });
    try {
      const models = await fetchModels(orchestratorUrl, comfyUiPath, category);
      set({ models, isLoadingModels: false, loadedCategory: category });
    } catch (err) {
      set({
        isLoadingModels: false,
        loadedCategory: '__error__',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  addDownloadTask: (task) =>
    set((s) => ({ downloadTasks: [...s.downloadTasks, task], downloadDrawerOpen: true })),

  updateDownloadTask: (taskId, updates) =>
    set((s) => ({
      downloadTasks: s.downloadTasks.map((t) =>
        t.task_id === taskId ? { ...t, ...updates } : t
      ),
    })),

  syncDownloadTasks: async (orchestratorUrl) => {
    try {
      const tasks = await listDownloadTasks(orchestratorUrl);
      set({ downloadTasks: tasks });
    } catch { /* ignore */ }
  },

  cancelTask: async (orchestratorUrl, taskId) => {
    await cancelDownload(orchestratorUrl, taskId);
    get().updateDownloadTask(taskId, { status: 'cancelled' });
  },

  removeTask: async (orchestratorUrl, taskId) => {
    await removeDownload(orchestratorUrl, taskId);
    set((s) => ({ downloadTasks: s.downloadTasks.filter((t) => t.task_id !== taskId) }));
  },

  pauseTask: async (orchestratorUrl, taskId) => {
    await pauseDownload(orchestratorUrl, taskId);
    get().updateDownloadTask(taskId, { status: 'paused' });
  },

  resumeTask: async (orchestratorUrl, taskId) => {
    await resumeDownload(orchestratorUrl, taskId);
    get().updateDownloadTask(taskId, { status: 'queued' });
  },

  bumpPriority: async (orchestratorUrl, taskId) => {
    const task = get().downloadTasks.find((t) => t.task_id === taskId);
    if (!task) return;
    const newPrio = Math.max(1, (task.priority ?? 5) - 1);
    await setDownloadPriority(orchestratorUrl, taskId, newPrio);
    get().updateDownloadTask(taskId, { priority: newPrio });
  },

  lowerPriority: async (orchestratorUrl, taskId) => {
    const task = get().downloadTasks.find((t) => t.task_id === taskId);
    if (!task) return;
    const newPrio = Math.min(9, (task.priority ?? 5) + 1);
    await setDownloadPriority(orchestratorUrl, taskId, newPrio);
    get().updateDownloadTask(taskId, { priority: newPrio });
  },
}));
