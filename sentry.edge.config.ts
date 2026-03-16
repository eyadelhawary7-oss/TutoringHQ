import * as Sentry from '@sentry/nextjs';

const isProd = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,
  tracesSampleRate: isProd ? 0.2 : 1.0,

  initialScope: {
    tags: { platform: 'centerhq' },
  },

  debug: false,
});
