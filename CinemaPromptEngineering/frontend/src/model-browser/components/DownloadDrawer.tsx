/**
 * DownloadDrawer — slide-up panel showing active and recent downloads.
 *
 * Each active task polls SSE progress from /api/downloads/{id}/progress.
 * Completed / failed tasks are shown statically.
 */

import { useEffect, useRef } from 'react';
import { useModelBrowserStore } from '../store/model-browser-store';
import { formatBytes } from '../services/model-browser-service';

interface DownloadDrawerProps {
  orchestratorUrl: string;
  open: boolean;
  onClose: () => void;
}

function formatBps(bps: number): string {
  if (bps <= 0) return '';
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'downloading': return 'Downloading';
    case 'done': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

export function DownloadDrawer({ orchestratorUrl, open, onClose }: DownloadDrawerProps) {
  const { downloadTasks, updateDownloadTask, cancelTask, removeTask } = useModelBrowserStore();

  // Track active SSE connections per task_id
  const sseRefs = useRef<Map<string, EventSource>>(new Map());

  // Start SSE for active tasks, clean up for completed
  useEffect(() => {
    if (!orchestratorUrl) return;

    downloadTasks.forEach((task) => {
      if (task.status !== 'queued' && task.status !== 'downloading') {
        // Close any stale SSE for completed tasks
        const existing = sseRefs.current.get(task.task_id);
        if (existing) {
          existing.close();
          sseRefs.current.delete(task.task_id);
        }
        return;
      }

      if (sseRefs.current.has(task.task_id)) return; // already polling

      const url = `${orchestratorUrl}/api/downloads/${task.task_id}/progress`;
      const es = new EventSource(url);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          updateDownloadTask(task.task_id, data);
          if (data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') {
            es.close();
            sseRefs.current.delete(task.task_id);
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es.close();
        sseRefs.current.delete(task.task_id);
      };

      sseRefs.current.set(task.task_id, es);
    });

    // Cleanup removed tasks
    sseRefs.current.forEach((es, id) => {
      if (!downloadTasks.find((t) => t.task_id === id)) {
        es.close();
        sseRefs.current.delete(id);
      }
    });
  }, [downloadTasks, orchestratorUrl, updateDownloadTask]);

  // Close all SSE on unmount
  useEffect(() => {
    const refs = sseRefs.current;
    return () => {
      refs.forEach((es) => es.close());
      refs.clear();
    };
  }, []);

  const activeCount = downloadTasks.filter(
    (t) => t.status === 'queued' || t.status === 'downloading'
  ).length;

  if (!open) return null;

  return (
    <div className="mb-drawer">
      <div className="mb-drawer__header">
        <span className="mb-drawer__title">
          Downloads
          {activeCount > 0 && (
            <span className="mb-drawer__badge">{activeCount}</span>
          )}
        </span>
        <div className="mb-drawer__header-actions">
          {downloadTasks.some((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') && (
            <button
              className="mb-drawer__clear"
              onClick={() => {
                downloadTasks
                  .filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled')
                  .forEach((t) => removeTask(orchestratorUrl, t.task_id));
              }}
            >
              Clear finished
            </button>
          )}
          <button className="mb-drawer__close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="mb-drawer__list">
        {downloadTasks.length === 0 && (
          <div className="mb-drawer__empty">No downloads yet.</div>
        )}

        {[...downloadTasks].reverse().map((task) => {
          const pct = task.total_bytes > 0
            ? Math.round((task.downloaded_bytes / task.total_bytes) * 100)
            : (task.progress ?? 0);

          const isActive = task.status === 'queued' || task.status === 'downloading';

          return (
            <div
              key={task.task_id}
              className={`mb-drawer__item mb-drawer__item--${task.status}`}
            >
              <div className="mb-drawer__item-name" title={task.filename}>
                {task.filename}
              </div>
              <div className="mb-drawer__item-path" title={task.target_path}>
                → {task.target_path}
              </div>

              {isActive && (
                <div className="mb-drawer__progress-row">
                  <div className="mb-drawer__progress-bar">
                    <div
                      className="mb-drawer__progress-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="mb-drawer__pct">{pct}%</span>
                </div>
              )}

              <div className="mb-drawer__item-meta">
                <span className={`mb-drawer__status mb-drawer__status--${task.status}`}>
                  {statusLabel(task.status)}
                </span>
                {task.total_bytes > 0 && (
                  <span className="mb-drawer__bytes">
                    {formatBytes(task.downloaded_bytes)} / {formatBytes(task.total_bytes)}
                  </span>
                )}
                {task.bps > 0 && isActive && (
                  <span className="mb-drawer__bps">{formatBps(task.bps)}</span>
                )}
                {task.error && (
                  <span className="mb-drawer__error" title={task.error}>
                    {task.error.slice(0, 80)}
                  </span>
                )}
              </div>

              <div className="mb-drawer__item-actions">
                {isActive && (
                  <button
                    className="mb-drawer__btn mb-drawer__btn--cancel"
                    onClick={() => cancelTask(orchestratorUrl, task.task_id)}
                  >
                    Cancel
                  </button>
                )}
                {!isActive && (
                  <button
                    className="mb-drawer__btn mb-drawer__btn--remove"
                    onClick={() => removeTask(orchestratorUrl, task.task_id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
