import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "elhawary-group",
  project: "javascript-nextjs",
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: true,
  },
  // Route browser requests to Sentry through a Next.js rewrite
  tunnelRoute: "/monitoring",
  // Hides source maps from generated client bundles
  // Automatically tree-shake Sentry logger statements to reduce bundle size
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
