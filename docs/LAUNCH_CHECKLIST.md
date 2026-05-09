# Launch checklist — CenterHQ

## Pre-launch (blocking)

- Vodafone postpaid SIM (WhatsApp + SMS fallback).
- Paymob **live** credentials & webhook URLs pinned to production.
- EHG registration via Adsero (commercial entity billing).
- Vercel env: `NEXT_PUBLIC_APP_URL`, `WHATSAPP_APP_SECRET`, `BOSTA_WEBHOOK_SECRET`, `VENDOR_WHATSAPP_NUMBER`, `ADMIN_WHATSAPP_NUMBER`, `BACKUP_DRIVE_FOLDER_ID`.
- Bosta merchant onboarding complete.
- Meta Business Verification (after SIM stabilizes).
- Brand lock: Looka logo + printed business cards.

## Day 1

- Redeploy after secrets applied.
- Smoke: signup funnel → dashboard, scanner admit path, admin finance loads non-zero aggregates (`is_test = false` default).
- Run `npx tsx scripts/security-audit.ts --all` with production base URL.

## Day 1–7 monitoring

- Sample `audit_log` for unusual admin mutations.
- Finance dashboard MRR sanity vs prior week.
- Cron heartbeat / logs — each scheduled job ran.
- `webhook_inbox` / DLQ — no stuck poison rows.
