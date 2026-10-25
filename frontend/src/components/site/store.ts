'use client';
/**
 * Per-device conveniences for the public site (saved listings, last reference).
 * Browser storage can be unavailable (private mode, blocked cookies) — every access
 * is wrapped so the site keeps working without it. Nothing private is stored here.
 */

const KEY = (slug: string, k: string) => `bilt:${slug}:${k}`;

function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export const saved = {
  list: (slug: string): string[] => read<string[]>(KEY(slug, 'saved'), []).filter((x) => typeof x === 'string').slice(0, 50),
  has: (slug: string, id: string) => saved.list(slug).includes(id),
  toggle(slug: string, id: string) {
    const cur = saved.list(slug);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, 50);
    write(KEY(slug, 'saved'), next);
    window.dispatchEvent(new CustomEvent('bilt:saved', { detail: { slug } }));
    return next.includes(id);
  },
  /** Add ids saved on the customer's account (other devices) without firing a reload event. */
  merge(slug: string, ids: string[]) {
    const cur = saved.list(slug);
    const add = ids.filter((x) => !cur.includes(x));
    if (add.length) write(KEY(slug, 'saved'), [...cur, ...add].slice(0, 50));
  },
};

/** Remember the last reference so the tracking form can be prefilled (reference only, never contact details). */
export const lastRef = {
  get: (slug: string) => read<string>(KEY(slug, 'ref'), ''),
  set: (slug: string, ref: string) => write(KEY(slug, 'ref'), ref),
};

/** One key per form submission attempt: retries of the same attempt are recognised by the server. */
export function newIdempotencyKey() {
  try { return crypto.randomUUID(); } catch { return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }
}
