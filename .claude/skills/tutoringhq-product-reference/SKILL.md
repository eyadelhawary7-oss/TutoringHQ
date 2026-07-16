---
name: tutoringhq-product-reference
description: TutoringHQ design system, WhatsApp template rules, and launch sequencing. Use when building or changing any UI screen, creating or sending WhatsApp templates, or planning launch, rollout, or onboarding work.
---

# Design system (center portal is the reference implementation, PR #146)
- Light theme only. Cream background, teal primary (bg-teal-600, hover bg-teal-700), tokens from globals.css and tokens.ts. No dark: variants ever, dark mode was fully removed.
- 8 approved page patterns, classified in docs/CENTER_PORTAL_REPAINT_CLASSIFICATION.md:
  Dashboard (quick actions on top, tight 2x2 stat grid, at-risk students promoted with actions, charts hidden when empty, exports demoted to a menu).
  List (search plus ONE primary Add button leading; all secondary actions live under a "More actions" section below the list).
  Form (modals preferred for small actions; Add and Edit pairs stay visually consistent, including inline quick-create where the Edit side has one).
  Settings (category menu leading to focused sub-pages, never one long scroll).
  Detail, Billing, Scanner, Group Proposals (see the classification doc for specifics).
- Pages classified "own look" (schedule grid, analytics, benchmarks, wizards, auth and status pages, checkout steps) get colors only, never forced into a pattern.
- RTL discipline: logical properties only (ms, me, ps, pe, start, end, text-start, text-end). Physical properties only in PDF, print, email HTML, and Recharts margins, marked RTL-EXEMPT.
- Arabic-first: default locale ar. All numbers and dates through formatNumber.ts helpers. The i18n parity, bidi, and tolocale gates must stay green, they break the build on purpose.
- Any release that changes UI, assets, or branding must bump SW_VERSION in public/sw.js. The app is an offline-first PWA and its caching layer serves previously saved pages first; without the version bump, returning devices keep seeing the old UI. This exact miss caused the stale students page after the July 2026 repaint.
- Teacher portal and Admin portal are NOT yet repainted. When touched, apply these same patterns as their own dedicated passes with classification first.

# WhatsApp template rules (sync with the master checklist)
- Every customer-facing template: Utility category, Arabic (EGY), Arabic comma U+060C.
- Category fix needed (delete and resubmit as Utility): chq_welcome, chq_onboarding_step1, chq_onboarding_step2. chq_renewal_reminder is already Utility, do not refix.
- Must create: chq_nudge_prebill, chq_nudge_due_today, chq_nudge_locked, chq_nudge_card_expiry, chq_fee_reminder, chq_pin_setup_link (dynamic URL button plus 15-minute token), chq_enrollment_otp. The 4 schedule templates wait until the schedule feature ships.
- chq_pin_delivery dropped off Meta: resubmit it or remove the reset-pin code path that calls it. chq_referral_commission has a wrong language tag (says English, body is Arabic).
- Every new template needs 24 to 48 hours of Meta approval. In-app banners work without WhatsApp and are the fallback. Template sends will be gated by consent checks in the PDPL phase 2 build.

# Launch sequence (order is locked, never skip a step)
1. Adsero completes company registration.
2. Paymob live keys arrive. No real customer before this point, ever.
3. One real end-to-end test payment.
4. Flip the summer first-charge gate per the written plan.
5. WhatsApp templates approved and live.
6. First pilot center onboarded DEEP: real student data loaded, running daily operations. Then widen.
- External penetration test happens before any real tenant with student data.
- First-cohort success metric: centers running full real daily operations, not signup counts. Tight-deep onboarding beats wide-shallow outreach for a solo founder.
