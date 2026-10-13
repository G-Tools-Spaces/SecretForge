import type { MetadataRoute } from 'next';

/**
 * robots.txt — allow the public pages, keep crawlers out of authenticated
 * areas, invite links, the auth callback and the API proxy.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/docs', '/login'],
      disallow: ['/projects', '/orgs', '/account', '/invite', '/auth', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
