import { createTranslator } from 'next-intl';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';

/** Server-side strings for backup crons and related API responses (locale: en). */
export const tCronBackup = createTranslator({
  locale: 'en',
  messages: en,
  namespace: 'cronBackup',
});

/** Arabic copy for WhatsApp messages to centers (Egypt). */
export const tCronWaAr = createTranslator({
  locale: 'ar',
  messages: ar,
  namespace: 'cronBackup',
});
