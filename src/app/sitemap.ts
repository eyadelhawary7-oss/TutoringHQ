import type { MetadataRoute } from 'next';

const BASE_URL = 'https://centerhq.app';
const LOCALES = ['ar', 'en'] as const;

type Route = {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
};

const ROUTES: Route[] = [
  { path: '/', priority: 1.0, changeFrequency: 'daily' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/compare/spreadsheets', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/features/qr-attendance', priority: 0.8, changeFrequency: 'weekly' },
  {
    path: '/features/student-management',
    priority: 0.8,
    changeFrequency: 'weekly',
  },
  {
    path: '/features/whatsapp-notifications',
    priority: 0.8,
    changeFrequency: 'weekly',
  },
  { path: '/blog', priority: 0.7, changeFrequency: 'daily' },
  { path: '/login', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/signup', priority: 0.6, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return ROUTES.flatMap((route) =>
    LOCALES.map((locale) => {
      const suffix = route.path === '/' ? '/' : route.path;
      return {
        url: `${BASE_URL}/${locale}${suffix}`,
        lastModified,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
      };
    }),
  );
}
