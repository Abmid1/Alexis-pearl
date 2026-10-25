import { NextResponse, type NextRequest } from 'next/server';

/**
 * Agency website routing by hostname.
 *
 * 1. Subdomains — NEXT_PUBLIC_ROOT_DOMAIN=biltafrica.com + wildcard DNS (*.biltafrica.com):
 *      abcproperties.biltafrica.com/…  →  /s/abcproperties/…
 * 2. Custom domains — CUSTOM_DOMAINS=1 and the agency owner saved the domain in Website settings:
 *      www.abcproperties.com/…  →  /s/<slug>/…   (looked up from the backend, cached 5 minutes)
 *    APP_HOSTS lists the workspace's own hostnames so they are never treated as agency domains.
 * Without these settings nothing changes: agencies use the path form /s/<slug>.
 * The slug is only a lookup key — the backend decides whether the agency exists and is live.
 */
const RESERVED = new Set(['app', 'www', 'api', 'admin']);
const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
const cache = new Map<string, { slug: string | null; at: number }>();
const TTL = 5 * 60 * 1000;

function rewriteTo(req: NextRequest, slug: string) {
  const url = req.nextUrl.clone();
  if (url.pathname.startsWith(`/s/${slug}`)) return NextResponse.next();   // links already carry the prefix
  url.pathname = `/s/${slug}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

async function slugForDomain(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.slug;
  let slug: string | null = null;
  try {
    const api = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const r = await fetch(`${api}/api/domains/resolve?host=${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) { const j = await r.json(); slug = SLUG.test(j.slug) ? j.slug : null; }
  } catch { /* backend unreachable: fall through to normal routing */ }
  if (cache.size > 1000) cache.clear();
  cache.set(host, { slug, at: Date.now() });
  return slug;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  if (root && host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (SLUG.test(sub) && !RESERVED.has(sub)) return rewriteTo(req, sub);
    return NextResponse.next();
  }

  if (process.env.CUSTOM_DOMAINS === '1') {
    const appHosts = (process.env.APP_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    const isApp = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host === root || appHosts.includes(host);
    if (!isApp && host) {
      const slug = await slugForDomain(host);
      if (slug) return rewriteTo(req, slug);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|favicon|icon.svg|manifest.json|robots.txt).*)'],
};
