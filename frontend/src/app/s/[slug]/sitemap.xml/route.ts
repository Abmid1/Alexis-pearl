import { getSitemap, getSite, propertyPath } from '@/lib/publicApi';

export const revalidate = 300;

/** Per-agency sitemap: /s/<slug>/sitemap.xml — published listings only. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const [site, map] = await Promise.all([getSite(params.slug).catch(() => null), getSitemap(params.slug).catch(() => null)]);
  if (!site || !map) return new Response('Not found', { status: 404 });
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urls = [
    `<url><loc>${esc(`${origin}/s/${site.company.slug}`)}</loc><changefreq>daily</changefreq></url>`,
    `<url><loc>${esc(`${origin}/s/${site.company.slug}/properties`)}</loc><changefreq>daily</changefreq></url>`,
    ...map.items.map((p) => `<url><loc>${esc(origin + propertyPath(site.company.slug, p))}</loc>${p.updated_at ? `<lastmod>${new Date(p.updated_at).toISOString()}</lastmod>` : ''}</url>`),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
