'use client';
import { PUBLIC_API } from '@/lib/publicApi';

/**
 * Customer session for ONE agency site. The token is kept in this browser only
 * (never in a URL) and is useless on other agencies' sites or the staff workspace.
 */
type Session = { token: string; name: string; expires: number };
const KEY = (slug: string) => `bilt:${slug}:session`;
const DAYS = 7;

export const session = {
  get(slug: string): Session | null {
    try {
      const s = JSON.parse(localStorage.getItem(KEY(slug)) || 'null') as Session | null;
      if (!s || s.expires < Date.now()) return null;
      return s;
    } catch { return null; }
  },
  set(slug: string, token: string, name: string) {
    try { localStorage.setItem(KEY(slug), JSON.stringify({ token, name, expires: Date.now() + DAYS * 86400000 - 60000 })); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent('bilt:session', { detail: { slug } }));
  },
  clear(slug: string) {
    try { localStorage.removeItem(KEY(slug)); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('bilt:session', { detail: { slug } }));
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = {}) { super(message); }
}

/** Call /api/public/<slug>/account/... with the customer's session. Clears it on 401. */
export async function accountApi<T = any>(slug: string, path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const s = session.get(slug);
  let r: Response;
  try {
    r = await fetch(`${PUBLIC_API}/api/public/${slug}/account${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Please check your connection.');
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && s) session.clear(slug);
  if (!r.ok) throw new ApiError(r.status, j.error || 'Something went wrong. Please try again.', j);
  return j as T;
}

export const fileToBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read the file'));
  reader.readAsDataURL(f);
});
