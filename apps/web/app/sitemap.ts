import type { MetadataRoute } from 'next';

/**
 * Sitemap for search engines. Only PUBLIC pages are listed — authenticated
 * areas (projects, orgs, account), token-bearing invite links and the auth
 * callback are intentionally excluded (and blocked in robots.ts).
 *
 * Set NEXT_PUBLIC_SITE_URL to the deployed origin (e.g. https://vault.acme.com).
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
