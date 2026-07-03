// One-tap pay / update-card deep links into the EXISTING pay flow. No new
// payment path: centers land on /pay and teachers on /teacher/pay (both render
// CustomerInvoicesView → POST /api/(teacher/)invoices/{id}/pay → Paymob iframe).
// Card-expiry "update card" links point at the same pay surface (per product
// decision) — updating the card == paying with a new card on the next charge.

import type { OwnerType } from './types';

const DEFAULT_BASE = 'https://tutoringhq.app';

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/** Relative pay path for an owner (client navigation / banner CTA). */
export function payPath(ownerType: OwnerType, locale: string): string {
  const loc = locale === 'en' ? 'en' : 'ar';
  return ownerType === 'teacher' ? `/${loc}/teacher/pay` : `/${loc}/pay`;
}

/** Relative update-card path — the existing pay surface (decision: pay surface). */
export function updateCardPath(ownerType: OwnerType, locale: string): string {
  return payPath(ownerType, locale);
}

/** Absolute pay URL for a WhatsApp message body. */
export function payUrl(ownerType: OwnerType, locale: string): string {
  return `${appBaseUrl()}${payPath(ownerType, locale)}`;
}

/** Absolute update-card URL for a WhatsApp message body. */
export function updateCardUrl(ownerType: OwnerType, locale: string): string {
  return `${appBaseUrl()}${updateCardPath(ownerType, locale)}`;
}
