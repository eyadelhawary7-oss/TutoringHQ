import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] as const }
        : false,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel.app https://*.vercel.app https://*.sentry.io https://*.ingest.sentry.io; frame-src 'self' https://*.supabase.co https://accept.paymob.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];

    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
          ...securityHeaders,
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          ...securityHeaders,
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          ...securityHeaders,
          { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
        ],
      },
    ];
  },
};

export default withSentryConfig(withBundleAnalyzer(withNextIntl(nextConfig)), {
  org: "elhawary-group",
  project: "javascript-nextjs",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: true,
  },
  // Hides source maps from generated client bundles
  // Automatically tree-shake Sentry logger statements to reduce bundle size
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
