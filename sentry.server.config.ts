import * as Sentry from '@sentry/nextjs';

const isProd = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,
  tracesSampleRate: isProd ? 0.2 : 1.0,

  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    'cancelled',
  ],

  beforeSend(event, hint) {
    if (process.env.NODE_ENV === 'development') {
      return null;
    }
    const error = hint.originalException;
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as Error).message)
      : '';
    if (
      message.includes('ChunkLoadError') ||
      message.includes('Loading chunk') ||
      message.includes('ResizeObserver')
    ) {
      return null;
    }
    return event;
  },

  initialScope: {
    tags: { platform: 'centerhq' },
  },

  debug: false,
});
