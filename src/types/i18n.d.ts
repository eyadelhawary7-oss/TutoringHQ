type Messages = typeof import('../../messages/ar.json');

declare global {
  // Use type safe message keys with `next-intl` (augmentation requires extending)
  interface IntlMessages extends Messages {
    _?: never;
  }
}
