import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

const validLocales = ['ar', 'en'] as const;
const defaultLocale = 'ar';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  const safeLocale = validLocales.includes(locale as (typeof validLocales)[number])
    ? (locale as (typeof validLocales)[number])
    : defaultLocale;

  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../../messages/${safeLocale}.json`)).default;
  } catch {
    try {
      messages = (await import('../../messages/ar.json')).default;
    } catch {
      messages = {};
    }
  }

  return {
    locale: safeLocale,
    messages,
  };
});
