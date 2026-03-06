/**
 * Zustand store for the Model Browser tab.
 */

import { create } from 'zustand';
import { ModelEntry, fetchConfig, fetchModels } from '../services/model-browser-service';

interface ModelBrowserStore {
  // Config
  categories: Record<string, string[]>;
  selectedCategory: string; // "" = All
  isLoadingConfig: boolean;

  // Models
  models: ModelEntry[];
  isLoadingModels: boolean;
  loadedCategory: string; // which category is currently loaded

  // Selection
  selectedModel: ModelEntry | null;

  // Filtering / sorting
  searchQuery: string;
  sortBy: 'name' | 'size' | 'modified';
  sortDir: 'asc' | 'desc';

  // Error
  error: string | null;

  // Actions
  setSelectedCategory: (cat: string) => void;
  setSelectedModel: (model: ModelEntry | null) => void;
  setSearchQuery: (q: string) => void;
  setSortBy: (field: 'name' | 'size' | 'modified') => void;
  setSortDir: (dir: 'asc' | 'desc') => void;
  clearError: () => void;

  loadConfig: (orchestratorUrl: string, comfyUiPath: string) => Promise<void>;
  loadModels: (
    orchestratorUrl: string,
    comfyUiPath: string,
    category: string
  ) => Promise<void>;
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

  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortBy: (field) => set({ sortBy: field }),
  setSortDir: (dir) => set({ sortDir: dir }),
  clearError: () => set({ error: null }),

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
    if (loadedCategory === category) return; // already loaded

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
}));
