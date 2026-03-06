/** API service for the system prompt editor. */

export interface SystemPromptListItem {
  id: string;
  name: string;
  type: 'general' | 'model';
  exists: boolean;
}

export interface SystemPromptDetail {
  id: string;
  content: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listPrompts(): Promise<SystemPromptListItem[]> {
  return apiFetch<SystemPromptListItem[]>('/system-prompts');
}

export async function fetchPrompt(id: string): Promise<SystemPromptDetail> {
  return apiFetch<SystemPromptDetail>(`/system-prompts/${encodeURIComponent(id)}`);
}

export async function savePrompt(id: string, content: string): Promise<void> {
  await apiFetch(`/system-prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function createPrompt(id: string, content: string): Promise<void> {
  await apiFetch('/system-prompts', {
    method: 'POST',
    body: JSON.stringify({ id, content }),
  });
}

export async function deletePrompt(id: string): Promise<void> {
  await apiFetch(`/system-prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
