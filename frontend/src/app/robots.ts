import type { MetadataRoute } from 'next';

/** Public agency sites are indexable; the private workspace and personal pages are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/s/'], disallow: ['/', '/s/*/track', '/s/*/saved'] }],
  };
}
