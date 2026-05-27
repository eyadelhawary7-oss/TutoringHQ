import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/api', '/settings', '/scanner'],
    },
    sitemap: 'https://centerhq.app/sitemap.xml',
  };
}
