import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CenterHQ — إدارة السناتر',
    short_name: 'CenterHQ',
    description: 'منصة إدارة السناتر التعليمية',
    start_url: '/ar/dashboard',
    display: 'standalone',
    background_color: '#080D14',
    theme_color: '#0D9488',
    orientation: 'portrait',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['education', 'business', 'productivity'],
    shortcuts: [
      {
        name: 'ماسح QR',
        short_name: 'ماسح',
        description: 'تسجيل الحضور',
        url: '/ar/scan',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'الطلاب',
        short_name: 'طلاب',
        description: 'إدارة الطلاب',
        url: '/ar/students',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
