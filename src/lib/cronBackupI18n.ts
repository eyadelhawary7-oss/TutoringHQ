import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';

/** Server-side strings for backup crons and related API responses (locale: en). */
export const tCronBackup = createTranslator({
  locale: 'en',
  messages: en,
  namespace: 'cronBackup',
});
