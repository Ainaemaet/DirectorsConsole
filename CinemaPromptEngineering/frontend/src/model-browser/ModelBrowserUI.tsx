/**
 * ModelBrowserUI — Top-level model browser tab.
 *
 * Two views:
 *   Library  — browse/search locally installed models by category
 *   Discover — search Civitai / HuggingFace and download models
 *
 * NSFW modes: hidden (filter .nsfw folders) | blurred (blur + icon) | visible
 * Download drawer: slide-up panel with SSE progress for active downloads.
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useModelBrowserStore } from './store/model-browser-store';
import { isModelNsfw } from './services/model-browser-service';
import { ModelCard } from './components/ModelCard';
import { ModelDetailPanel } from './components/ModelDetailPanel';
import { DiscoverPanel } from './components/DiscoverPanel';
import { DownloadDrawer } from './components/DownloadDrawer';
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
    activeView,
    nsfwMode,
    downloadTasks,
    downloadDrawerOpen,
    setSelectedCategory,
    setSelectedModel,
    setSearchQuery,
    setSortBy,
    setSortDir,
    clearError,
    setActiveView,
    setNsfwMode,
    setDownloadDrawerOpen,
    loadConfig,
    loadModels,
    syncDownloadTasks,
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

  // Sync download tasks when tab becomes active
  useEffect(() => {
    if (!isActive || !orchestratorUrl) return;
    syncDownloadTasks(orchestratorUrl);
  }, [isActive, orchestratorUrl, syncDownloadTasks]);

  const categoryNames = Object.keys(categories).sort();
  const totalCount = models.length;

  // Filtered + sorted models (client-side)
  const displayModels = useMemo(() => {
    let list = models;

    // Apply NSFW filter (hidden mode removes .nsfw folder models)
    if (nsfwMode === 'hidden') {
      list = list.filter((m) => !isModelNsfw(m));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.filename.toLowerCase().includes(q) ||
          m.base_model.toLowerCase().includes(q) ||
          m.subfolder.toLowerCase().includes(q) ||
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
  }, [models, searchQuery, sortBy, sortDir, nsfwMode]);

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

  const activeDownloads = downloadTasks.filter(
    (t) => t.status === 'queued' || t.status === 'downloading'
  ).length;

  const cycleNsfwMode = () => {
    const next = nsfwMode === 'hidden' ? 'blurred' : nsfwMode === 'blurred' ? 'visible' : 'hidden';
    setNsfwMode(next);
  };

  const nsfwIcon = nsfwMode === 'hidden' ? '🚫' : nsfwMode === 'blurred' ? '👁️' : '👁️‍🗨️';
  const nsfwTitle =
    nsfwMode === 'hidden' ? 'NSFW: Hidden (click to blur)' :
    nsfwMode === 'blurred' ? 'NSFW: Blurred (click to show)' :
    'NSFW: Visible (click to hide)';

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
        {/* View toggle */}
        <div className="mb-toolbar__view-tabs">
          <button
            className={`mb-toolbar__view-tab ${activeView === 'library' ? 'mb-toolbar__view-tab--active' : ''}`}
            onClick={() => setActiveView('library')}
          >
            Library
          </button>
          <button
            className={`mb-toolbar__view-tab ${activeView === 'discover' ? 'mb-toolbar__view-tab--active' : ''}`}
            onClick={() => setActiveView('discover')}
          >
            Discover
          </button>
        </div>

        {activeView === 'library' && (
          <>
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
                className="mb-toolbar__btn"
                onClick={handleOpenInStudio}
                title={`Send "${selectedModel.name}" to Studio tab`}
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
          </>
        )}

        <div className="mb-toolbar__spacer" />

        {/* NSFW toggle */}
        <button
          className="mb-toolbar__nsfw"
          onClick={cycleNsfwMode}
          title={nsfwTitle}
          data-mode={nsfwMode}
        >
          {nsfwIcon}
        </button>

        {/* Download queue button */}
        <button
          className={`mb-toolbar__downloads ${activeDownloads > 0 ? 'mb-toolbar__downloads--active' : ''}`}
          onClick={() => setDownloadDrawerOpen(!downloadDrawerOpen)}
          title="Download queue"
        >
          ⬇{activeDownloads > 0 ? ` ${activeDownloads}` : ''}
        </button>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="mb-error-banner">
          <span>{error}</span>
          <button onClick={clearError}>✕</button>
        </div>
      )}

      {/* ── Discover view ──────────────────────────────────────────────── */}
      {activeView === 'discover' && (
        <DiscoverPanel
          orchestratorUrl={orchestratorUrl}
          categories={categories}
        />
      )}

      {/* ── Library view ───────────────────────────────────────────────── */}
      {activeView === 'library' && (
        <div className="mb-body">
          {/* Sidebar: categories */}
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

          {/* Main: grid */}
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
                    nsfwMode={nsfwMode}
                    onClick={() =>
                      setSelectedModel(selectedModel?.path === model.path ? null : model)
                    }
                  />
                ))}
              </div>
            )}
          </main>

          {/* Detail panel */}
          {selectedModel && (
            <ModelDetailPanel
              model={selectedModel}
              orchestratorUrl={orchestratorUrl}
              onClose={() => setSelectedModel(null)}
            />
          )}
        </div>
      )}

      {/* ── Download drawer ────────────────────────────────────────────── */}
      <DownloadDrawer
        orchestratorUrl={orchestratorUrl}
        open={downloadDrawerOpen}
        onClose={() => setDownloadDrawerOpen(false)}
      />
    </div>
  );
}
