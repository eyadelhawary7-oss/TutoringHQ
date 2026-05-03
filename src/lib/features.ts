// Master feature flags — only toggled by Eyad directly in code
// Setting to false = completely hidden from ALL users and staff
//
// Env checklist (Vercel + `.env.local`) — never commit real values:
// - NEXT_PUBLIC_SUPPORT_WHATSAPP — digits only; wa.me support & marketing links
// - ADMIN_WHATSAPP_NUMBER — optional digits; server/cron WhatsApp alerts; falls back to NEXT_PUBLIC_SUPPORT_WHATSAPP
// - PAYMOB_* — see Paymob block below
// - WHATSAPP_TOKEN, PHONE_NUMBER_ID, WHATSAPP_APP_SECRET — Meta Cloud API
// - CRON_SECRET — Bearer for /api/cron/*
// - SALES_MANAGER_PHONE — sales alerts (E.164 or local digits)

// TO ENABLE PAYMOB:
// 1. Set PAYMOB_ENABLED to true in this file
// 2. Add env vars to Vercel: PAYMOB_API_KEY, PAYMOB_INTEGRATION_ID,
//    PAYMOB_HMAC_SECRET, PAYMOB_IFRAME_ID
// 3. Deploy — the "ادفع الآن" button will appear for all centers
// 4. Register webhook in Paymob dashboard:
//    URL: https://centerhq.app/api/webhooks/paymob

export const FEATURES: { PAYMOB_ENABLED: boolean } = {
  PAYMOB_ENABLED: false, // Set to true to unlock for everyone
};

// Helper
export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature] === true;
}
