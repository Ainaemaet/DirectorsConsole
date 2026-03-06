/**
 * ModelBrowserUI — Top-level model browser tab.
 *
 * Reads ComfyUI model directories from extra_model_paths.yaml (via Orchestrator),
 * displays a searchable/sortable grid of model cards, and a detail panel on selection.
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useModelBrowserStore } from './store/model-browser-store';
import { ModelCard } from './components/ModelCard';
import { ModelDetailPanel } from './components/ModelDetailPanel';
import { MODEL_NODE_MAP } from '../studio/services/studio-bridge';
import './ModelBrowserUI.css';

interface ModelBrowserUIProps {
  orchestratorUrl: string;
  comfyUiPath: string;
  isActive?: boolean;
}

export function ModelBrowserUI({ orchestratorUrl, comfyUiPath, isActive = true }: ModelBrowserUIProps) {
  const {
    categories,
    selectedCategory,
    isLoadingConfig,
    models,
    isLoadingModels,
    loadedCategory,
    selectedModel,
    searchQuery,
    sortBy,
    sortDir,
    error,
    setSelectedCategory,
    setSelectedModel,
    setSearchQuery,
    setSortBy,
    setSortDir,
    clearError,
    loadConfig,
    loadModels,
  } = useModelBrowserStore();

  // Load category config when tab becomes active or settings change
  useEffect(() => {
    if (!isActive || !orchestratorUrl || !comfyUiPath) return;
    loadConfig(orchestratorUrl, comfyUiPath);
  }, [isActive, orchestratorUrl, comfyUiPath, loadConfig]);

  // Load models when selected category changes
  useEffect(() => {
    if (!isActive || !orchestratorUrl || !comfyUiPath || !selectedCategory) return;
    if (loadedCategory === selectedCategory) return;
    loadModels(orchestratorUrl, comfyUiPath, selectedCategory);
  }, [isActive, orchestratorUrl, comfyUiPath, selectedCategory, loadedCategory, loadModels]);

  const categoryNames = Object.keys(categories).sort();
  const totalCount = models.length;

  // Filtered + sorted models (client-side, fast)
  const displayModels = useMemo(() => {
    let list = models;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.filename.toLowerCase().includes(q) ||
          m.base_model.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.trained_words.some((w) => w.toLowerCase().includes(q))
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
      if (sortBy === 'size') return dir * (a.size_bytes - b.size_bytes);
      if (sortBy === 'modified') return dir * (a.modified - b.modified);
      return 0;
    });

    return list;
  }, [models, searchQuery, sortBy, sortDir]);

  const handleCategoryClick = useCallback(
    (cat: string) => {
      if (cat === selectedCategory) return;
      setSelectedCategory(cat);
      setSelectedModel(null);
    },
    [selectedCategory, setSelectedCategory, setSelectedModel]
  );

  const handleRefresh = useCallback(() => {
    if (!orchestratorUrl || !comfyUiPath) return;
    // Force reload by resetting loadedCategory
    useModelBrowserStore.setState({ loadedCategory: '__none__', models: [], selectedModel: null });
    loadConfig(orchestratorUrl, comfyUiPath);
    if (selectedCategory) {
      loadModels(orchestratorUrl, comfyUiPath, selectedCategory);
    }
  }, [orchestratorUrl, comfyUiPath, selectedCategory, loadConfig, loadModels]);

  const toggleSortDir = () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc');

  const handleOpenInStudio = useCallback(() => {
    if (!selectedModel) return;
    const mapping = MODEL_NODE_MAP[selectedModel.category];
    if (!mapping) return;
    window.dispatchEvent(
      new CustomEvent('studio:add-model', {
        detail: {
          category: selectedModel.category,
          filename: selectedModel.filename,
          nodeType: mapping.nodeType,
          inputName: mapping.inputName,
        },
      })
    );
    window.dispatchEvent(new CustomEvent('app:navigate-tab', { detail: 'studio' }));
  }, [selectedModel]);

  // ── Empty state: ComfyUI path not set ──────────────────────────────────
  if (!comfyUiPath) {
    return (
      <div className="mb-root mb-root--empty">
        <div className="mb-empty-state">
          <div className="mb-empty-state__icon">🧠</div>
          <h2>Model Browser</h2>
          <p>
            Set your <strong>ComfyUI Installation Path</strong> in Project Settings to discover
            your models.
          </p>
          <p className="mb-empty-state__hint">
            Project Settings → Model Browser → ComfyUI Installation Path
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-root">
      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="mb-toolbar">
        <input
          className="mb-toolbar__search"
          type="text"
          placeholder="Search models…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div className="mb-toolbar__sort">
          <select
            className="mb-toolbar__sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'size' | 'modified')}
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="modified">Modified</option>
          </select>
          <button
            className="mb-toolbar__sort-dir"
            onClick={toggleSortDir}
            title={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        <button
          className="mb-toolbar__refresh"
          onClick={handleRefresh}
          title="Refresh model list"
          disabled={isLoadingConfig || isLoadingModels}
        >
          ↻
        </button>

        {selectedModel && MODEL_NODE_MAP[selectedModel.category] && (
          <button
            className="mb-toolbar__refresh"
            onClick={handleOpenInStudio}
            title={`Send "${selectedModel.name}" to Studio tab`}
            style={{ padding: '0 10px', fontSize: '12px' }}
          >
            Open in Studio ↗
          </button>
        )}

        {selectedCategory && !isLoadingModels && (
          <span className="mb-toolbar__count">
            {displayModels.length}
            {searchQuery ? ` / ${totalCount}` : ''}
          </span>
        )}
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="mb-error-banner">
          <span>{error}</span>
          <button onClick={clearError}>✕</button>
        </div>
      )}

      <div className="mb-body">
        {/* ── Sidebar: categories ──────────────────────────────────────── */}
        <aside className="mb-sidebar">
          {isLoadingConfig && (
            <div className="mb-sidebar__loading">Loading categories…</div>
          )}
          {!isLoadingConfig && categoryNames.length === 0 && !error && (
            <div className="mb-sidebar__empty">No categories found</div>
          )}
          {categoryNames.map((cat) => (
            <button
              key={cat}
              className={`mb-sidebar__cat ${selectedCategory === cat ? 'mb-sidebar__cat--active' : ''}`}
              onClick={() => handleCategoryClick(cat)}
            >
              {cat}
            </button>
          ))}
        </aside>

        {/* ── Main: grid ───────────────────────────────────────────────── */}
        <main className="mb-main">
          {!selectedCategory && !isLoadingConfig && categoryNames.length > 0 && (
            <div className="mb-main__prompt">
              Select a category from the sidebar to browse models.
            </div>
          )}

          {isLoadingModels && (
            <div className="mb-main__loading">
              <div className="mb-spinner" />
              <span>Scanning models…</span>
            </div>
          )}

          {!isLoadingModels && selectedCategory && displayModels.length === 0 && !error && (
            <div className="mb-main__empty">
              {searchQuery ? 'No models match your search.' : 'No models found in this category.'}
            </div>
          )}

          {!isLoadingModels && displayModels.length > 0 && (
            <div className="mb-grid">
              {displayModels.map((model) => (
                <ModelCard
                  key={model.path}
                  model={model}
                  orchestratorUrl={orchestratorUrl}
                  isSelected={selectedModel?.path === model.path}
                  onClick={() =>
                    setSelectedModel(selectedModel?.path === model.path ? null : model)
                  }
                />
              ))}
            </div>
          )}
        </main>

        {/* ── Detail panel ─────────────────────────────────────────────── */}
        {selectedModel && (
          <ModelDetailPanel
            model={selectedModel}
            orchestratorUrl={orchestratorUrl}
            onClose={() => setSelectedModel(null)}
          />
        )}
      </div>
    </div>
  );
}
