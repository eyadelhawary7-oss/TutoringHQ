import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  environment: process.env.NODE_ENV,

  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    'cancelled',
  ],

  beforeSend(event, _hint) {
    if (process.env.NODE_ENV === 'development') {
      return null;
    }
    return event;
  },

  debug: false,
});
