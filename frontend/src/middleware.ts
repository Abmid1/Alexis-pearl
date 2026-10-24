import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional subdomain routing for agency websites.
 *
 * With NEXT_PUBLIC_ROOT_DOMAIN=biltafrica.com and a wildcard DNS record (*.biltafrica.com),
 * abcproperties.biltafrica.com/…  is served from  /s/abcproperties/…
 * Without that env var nothing changes: agencies use the path form /s/<slug>.
 * The slug is only a lookup key — the backend decides whether the agency exists and is live.
 */
const RESERVED = new Set(['app', 'www', 'api', 'admin']);

export function middleware(req: NextRequest) {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!root) return NextResponse.next();
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!host.endsWith(`.${root}`)) return NextResponse.next();
  const sub = host.slice(0, -(root.length + 1));
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(sub) || RESERVED.has(sub)) return NextResponse.next();

  const url = req.nextUrl.clone();
  if (url.pathname.startsWith(`/s/${sub}`)) return NextResponse.next();   // links already carry the prefix
  url.pathname = `/s/${sub}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon|icon.svg|manifest.json|robots.txt).*)'],
};
