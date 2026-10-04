let userId = localStorage.getItem('cash-demo-uid') || '';

export function getUserId() {
  return userId;
}
export function setUserId(id: string) {
  userId = id;
  localStorage.setItem('cash-demo-uid', id);
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join('；') : body.message;
    throw new Error(msg || `请求失败（${res.status}）`);
  }
  return body as T;
}
