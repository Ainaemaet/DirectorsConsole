import { useState, useEffect, useRef, useCallback } from 'react';
import './PromptEditorUI.css';
import {
  listPrompts,
  fetchPrompt,
  savePrompt,
  createPrompt,
  deletePrompt,
  type SystemPromptListItem,
} from './services/prompt-editor-service';

interface Props {
  isActive: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function PromptEditorUI({ isActive }: Props) {
  const [prompts, setPrompts] = useState<SystemPromptListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [newPromptMode, setNewPromptMode] = useState(false);
  const [newPromptId, setNewPromptId] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDirty = editedContent !== originalContent;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listPrompts();
      setPrompts(items);
    } catch {
      // list errors are silent — user will see an empty sidebar
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive && prompts.length === 0) {
      loadList();
    }
  }, [isActive, loadList, prompts.length]);

  function clearStatusAfterDelay() {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus('idle'), 3000);
  }

  async function selectPrompt(id: string) {
    if (id === selectedId) return;
    if (isDirty) {
      if (!window.confirm('Discard unsaved changes?')) return;
    }
    setStatus('idle');
    try {
      const detail = await fetchPrompt(id);
      setSelectedId(id);
      setOriginalContent(detail.content);
      setEditedContent(detail.content);
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Failed to load prompt');
    }
  }

  async function handleSave() {
    if (!selectedId || !isDirty) return;
    setStatus('saving');
    try {
      await savePrompt(selectedId, editedContent);
      setOriginalContent(editedContent);
      setStatus('saved');
      clearStatusAfterDelay();
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Save failed');
    }
  }

  function handleDiscard() {
    setEditedContent(originalContent);
    setStatus('idle');
  }

  function handleNewClick() {
    if (isDirty) {
      if (!window.confirm('Discard unsaved changes?')) return;
    }
    setNewPromptMode(true);
    setNewPromptId('');
    setTimeout(() => newInputRef.current?.focus(), 50);
  }

  async function handleCreate() {
    const id = newPromptId.trim();
    if (!id) return;
    try {
      await createPrompt(id, '');
      await loadList();
      setNewPromptMode(false);
      setNewPromptId('');
      // Select the new prompt
      const detail = await fetchPrompt(id);
      setSelectedId(id);
      setOriginalContent(detail.content);
      setEditedContent(detail.content);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function handleDelete() {
    if (!selectedId || selectedId === 'general') return;
    if (!window.confirm(`Delete prompt "${selectedId}"? This cannot be undone.`)) return;
    try {
      await deletePrompt(selectedId);
      setSelectedId(null);
      setOriginalContent('');
      setEditedContent('');
      setStatus('idle');
      await loadList();
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const generalPrompts = prompts.filter(p => p.type === 'general');
  const modelPrompts = prompts.filter(p => p.type === 'model');

  const selectedPrompt = prompts.find(p => p.id === selectedId);

  return (
    <div className="pe-root">
      {/* ── Sidebar ── */}
      <aside className="pe-sidebar">
        <div className="pe-sidebar__header">
          <span className="pe-sidebar__title">System Prompts</span>
          <button className="pe-btn-new" onClick={handleNewClick}>+ New</button>
        </div>

        <div className="pe-list">
          {loading && <div style={{ padding: '12px 14px', fontSize: 12, opacity: 0.5 }}>Loading…</div>}

          {/* General section */}
          {generalPrompts.length > 0 && (
            <div className="pe-list__section">
              <div className="pe-list__section-label">General</div>
              {generalPrompts.map(p => (
                <button
                  key={p.id}
                  className={`pe-list__item${selectedId === p.id ? ' active' : ''}${!p.exists ? ' pe-list__item--missing' : ''}`}
                  onClick={() => selectPrompt(p.id)}
                >
                  <span className={`pe-list__dot${!p.exists ? ' pe-list__dot--missing' : ''}`} />
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* Model prompts section */}
          {modelPrompts.length > 0 && (
            <div className="pe-list__section">
              <div className="pe-list__section-label">Model Prompts</div>
              {modelPrompts.map(p => (
                <button
                  key={p.id}
                  className={`pe-list__item${selectedId === p.id ? ' active' : ''}${!p.exists ? ' pe-list__item--missing' : ''}`}
                  onClick={() => selectPrompt(p.id)}
                >
                  <span className={`pe-list__dot${!p.exists ? ' pe-list__dot--missing' : ''}`} />
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* Inline new-prompt form */}
          {newPromptMode && (
            <div className="pe-list__section">
              <div className="pe-list__section-label">New Prompt</div>
              <div className="pe-new-form">
                <input
                  ref={newInputRef}
                  className="pe-new-form__input"
                  placeholder="model-id (e.g. flux_2)"
                  value={newPromptId}
                  onChange={e => setNewPromptId(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setNewPromptMode(false); setNewPromptId(''); }
                  }}
                />
                <button className="pe-btn-create" onClick={handleCreate} disabled={!newPromptId.trim()}>
                  Create
                </button>
                <button className="pe-btn-cancel" onClick={() => { setNewPromptMode(false); setNewPromptId(''); }}>
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Editor panel ── */}
      <div className="pe-editor">
        {!selectedId ? (
          <div className="pe-editor__placeholder">
            Select a prompt to edit
          </div>
        ) : (
          <>
            <div className="pe-editor__header">
              <div className="pe-editor__prompt-name">
                {selectedPrompt?.name ?? selectedId}
                <span className="pe-editor__prompt-id">{selectedId}.md</span>
              </div>
              <button
                className="pe-btn-delete"
                onClick={handleDelete}
                disabled={selectedId === 'general'}
                title={selectedId === 'general' ? 'The general prompt cannot be deleted' : `Delete ${selectedId}`}
              >
                Delete
              </button>
            </div>

            <textarea
              className="pe-editor__textarea"
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
              spellCheck={false}
            />

            <div className="pe-editor__footer">
              <button
                className="pe-btn-save"
                onClick={handleSave}
                disabled={!isDirty || status === 'saving'}
              >
                {status === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button
                className="pe-btn-discard"
                onClick={handleDiscard}
                disabled={!isDirty}
              >
                Discard
              </button>

              {status === 'saved' && <span className="pe-status pe-status--saved">Saved</span>}
              {status === 'error' && <span className="pe-status pe-status--error">{statusMessage}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
