import { auth } from './firebase';

export class ApiClientError extends Error {
  constructor(public status: number, public code: string) { super(''); this.name = 'ApiClientError'; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const token = await auth.currentUser?.getIdToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, cache: 'no-store', headers });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) { const error = new ApiClientError(response.status, body.error ?? 'REQUEST_FAILED'); error.message = body.message ?? 'Wystąpił błąd. Spróbuj ponownie.'; throw error; }
  return body as T;
}
