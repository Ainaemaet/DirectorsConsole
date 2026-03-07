/**
 * BulkScanModal — Trigger a server-side bulk Civitai metadata scan.
 *
 * Scope options: all models | single category | single folder path.
 * Results stream via SSE; each model result is shown in a scrollable log.
 * Rate-limited server-side to 1 Civitai request/second.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { startBulkScan, type BulkScanEvent } from '../services/model-browser-service';

interface BulkScanModalProps {
  orchestratorUrl: string;
  comfyUiPath: string;
  categories: Record<string, string[]>;
  onClose: () => void;
}

interface LogEntry {
  key: number;
  text: string;
  status: 'found' | 'not_found' | 'error' | 'info';
}

export function BulkScanModal({
  orchestratorUrl,
  comfyUiPath,
  categories,
  onClose,
}: BulkScanModalProps) {
  const [scope, setScope] = useState<'all' | 'category' | 'folder'>('all');
  const [category, setCategory] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const keyRef = useRef(0);

  const categoryNames = Object.keys(categories).sort();

  const addLog = useCallback((text: string, status: LogEntry['status']) => {
    setLog((prev) => [...prev, { key: ++keyRef.current, text, status }]);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const handleStart = useCallback(() => {
    if (running) return;
    setLog([]);
    setProgress(0);
    setTotal(0);
    setDone(false);
    setRunning(true);

    const payload = {
      comfy_ui_path: comfyUiPath,
      scope,
      category: scope === 'category' ? category : undefined,
      folder_path: scope === 'folder' ? folderPath : undefined,
      overwrite,
    };

    const cancel = startBulkScan(orchestratorUrl, payload, (evt: BulkScanEvent) => {
      switch (evt.type) {
        case 'start':
          setTotal(evt.total ?? 0);
          addLog(`Starting scan — ${evt.total ?? 0} model(s) to check`, 'info');
          break;
        case 'progress': {
          const idx = (evt.index ?? 0) + 1;
          setProgress(idx);
          const name = evt.path ? evt.path.split(/[/\\]/).pop() ?? evt.path : '?';
          if (evt.error) {
            addLog(`[${idx}] ${name} — ERROR: ${evt.error}`, 'error');
          } else if (evt.found) {
            addLog(`[${idx}] ${name} — found: ${evt.model_name ?? ''}`, 'found');
          } else {
            addLog(`[${idx}] ${name} — not on Civitai`, 'not_found');
          }
          break;
        }
        case 'done':
          addLog(
            `Done — found: ${evt.found ?? 0}, not found: ${evt.not_found ?? 0}, errors: ${evt.errors ?? 0}`,
            'info'
          );
          setRunning(false);
          setDone(true);
          cancelRef.current = null;
          break;
        case 'error':
          addLog(`Error: ${evt.message}`, 'error');
          setRunning(false);
          cancelRef.current = null;
          break;
      }
    });

    cancelRef.current = cancel;
  }, [running, orchestratorUrl, comfyUiPath, scope, category, folderPath, overwrite, addLog]);

  const handleStop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setRunning(false);
    addLog('Scan cancelled.', 'info');
  }, [addLog]);

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="bscan-overlay" onClick={onClose}>
      <div className="bscan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bscan-header">
          <span className="bscan-title">Scan for Missing Metadata</span>
          <button className="bscan-close" onClick={onClose} disabled={running}>✕</button>
        </div>

        {/* Scope selector */}
        <div className="bscan-form">
          <div className="bscan-row">
            <label className="bscan-lbl">Scope</label>
            <div className="bscan-scope-btns">
              {(['all', 'category', 'folder'] as const).map((s) => (
                <button
                  key={s}
                  className={`bscan-scope-btn${scope === s ? ' bscan-scope-btn--active' : ''}`}
                  onClick={() => setScope(s)}
                  disabled={running}
                >
                  {s === 'all' ? 'All categories' : s === 'category' ? 'Category' : 'Folder'}
                </button>
              ))}
            </div>
          </div>

          {scope === 'category' && (
            <div className="bscan-row">
              <label className="bscan-lbl">Category</label>
              <select
                className="bscan-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={running}
              >
                <option value="">— choose —</option>
                {categoryNames.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'folder' && (
            <div className="bscan-row">
              <label className="bscan-lbl">Folder path</label>
              <input
                className="bscan-input"
                type="text"
                placeholder="Absolute path to folder"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                disabled={running}
              />
            </div>
          )}

          <div className="bscan-row">
            <label className="bscan-lbl bscan-lbl--check">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                disabled={running}
              />
              Overwrite existing metadata
            </label>
          </div>

          <p className="bscan-hint">
            Models without a .metadata.json or .civitai.info file will be looked up
            on Civitai by SHA-256 hash. Rate-limited to 1 request/second.
          </p>
        </div>

        {/* Progress */}
        {(running || done) && (
          <div className="bscan-progress-area">
            <div className="bscan-progress-bar">
              <div className="bscan-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="bscan-progress-label">{progress} / {total} ({pct}%)</span>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="bscan-log" ref={logRef}>
            {log.map((entry) => (
              <div key={entry.key} className={`bscan-log-line bscan-log-line--${entry.status}`}>
                {entry.text}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="bscan-footer">
          {!running && !done && (
            <button
              className="bscan-btn bscan-btn--start"
              onClick={handleStart}
              disabled={
                (scope === 'category' && !category) ||
                (scope === 'folder' && !folderPath.trim())
              }
            >
              Start Scan
            </button>
          )}
          {running && (
            <button className="bscan-btn bscan-btn--stop" onClick={handleStop}>
              Stop
            </button>
          )}
          {done && (
            <button className="bscan-btn bscan-btn--start" onClick={() => { setDone(false); setLog([]); setProgress(0); setTotal(0); }}>
              Scan Again
            </button>
          )}
          <button className="bscan-btn" onClick={onClose} disabled={running}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
