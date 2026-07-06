# Auth pages cream redesign — findings

Redesign of the last three dark auth pages (`/signup`, `/session-expired`,
`/accept-invite`) into the cream + teal look, finishing the "zero dark anywhere"
goal. **Styling only — every bit of auth logic stays byte-identical.**

Approach: pilot `/session-expired` first (Phase A), hold for review, then apply
the same established style to `/signup` and `/accept-invite` (Phase B).

---

## Phase A — pilot `/session-expired` (DONE, awaiting review)

### What changed

**`src/app/[locale]/session-expired/page.tsx`** — redesigned to the cream/teal
look, consistent with the already-light `/login` page family:

- Cream page background via `var(--color-surface-0)` (was hardcoded `#080f1a`).
- Soft white card via `var(--color-surface-1)`, `1px var(--color-border)`,
  `border-radius: 20px`, one gentle shadow `var(--shadow-md)`, generous padding.
- Teal clock-icon badge: `var(--color-teal-soft)` fill, `var(--color-border-brand)`
  hairline, icon stroked `var(--color-teal)` (was dark `teal-900/20` chip +
  `#0D9488` hardcoded stroke).
- Title in the Playfair display face (matching `/login`), `var(--color-text-primary)`
  (was `text-white`); description `var(--color-text-secondary)` (was `text-slate-400`).
- Primary CTA: full-width teal button `var(--color-teal)`, white label, keeps the
  existing `btn-press` + `chq-focus` utility classes.
- Removed `import { LoginThemeEffect }` and its `<LoginThemeEffect />` render — this
  page no longer asks the document root to go `.dark`.
- RTL-safe: logical spacing only; no physical `left/right/ml/mr`.

The **only interactive element is `<Link href="/login">`**, preserved verbatim. This
page has no form, no OTP, no submit, no redirect logic — so "auth logic unchanged"
is trivially and fully satisfied here.

**`src/app/globals.css`** — removed the three `[data-chq-session-expired]` dark
locks (following the exact precedent set for `[data-chq-login]` in the ADR 031 pass):

1. The token lock (`--color-surface-0: #080f1a !important` … block) — dropped the
   `[data-chq-session-expired]` selector, kept `[data-chq-signup]` (signup is still
   dark until Phase B).
2. The full-page dark surface block (`background-color: #080f1a` + `.text-white` /
   `.text-slate-400` overrides) — removed entirely, replaced with a "do not re-add"
   comment.
3. The dark-canvas anti-flash block (`[data-chq-signup], [data-chq-session-expired]`
   + the `html:has(...)` / `body:has(...)` rules) — dropped the
   `[data-chq-session-expired]` selectors, kept the `[data-chq-signup]` ones.

The `data-chq-session-expired` attribute is **kept on the page element** as an inert
page marker — same as `data-chq-login` on `/login`. With all three CSS locks gone it
resolves the cream surface tokens like the rest of the app.

### Verification

Screenshots captured with the dev-server + Playwright method from the dark-mode
removal task (`colorScheme` emulation, `executablePath: /opt/pw-browsers/chromium`):

| Render | `<html>` class | root `color-scheme` | body bg | result |
|---|---|---|---|---|
| Before `/ar/session-expired` | `dark` | `dark` | `rgb(8,15,26)` `#080f1a` | dark (old) |
| After  `/ar/session-expired` | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |
| After  `/en/session-expired` | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |
| After  `/ar` under **emulated dark OS** | `(none)` | `light` | `rgb(236,232,223)` cream | **light** |

The emulated-dark-OS render being identical to the light render proves the page stays
cream regardless of device preference, and that dropping `<LoginThemeEffect />` leaves
no `.dark` stranded on the root.

Gates (all green):

- [x] `next build` — compiled in ~50s, **394/394** static pages generated, exit 0.
- [x] Unit suite — **1147 passed / 141 files**.
- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — **0 errors** (162 pre-existing warnings, all in untouched test files).
- [x] `verify:stabilization` — i18n (3832 keys, en/ar parity), bidi, tolocale all OK.

Logic diff: **styling/markup only.** `git diff` touches exactly two files
(`page.tsx`, `globals.css`); no API route, helper, schema, or auth module changed.

---

## Phase B — `/signup` and `/accept-invite` (DONE, awaiting final review)

Pilot look approved by Eyad. Same cream/teal card style applied to both pages.

### What changed

**`src/app/[locale]/signup/SignupForm.tsx`** — full styling pass, logic untouched:

- Page canvas cream `var(--color-surface-0)` (was `#080f1a` / `#080D14`); removed the
  dark decorative teal radial glow layers (the `breathe`-animated blob and the success
  glow — pure `aria-hidden` decoration, wrong on cream).
- `UnderlineInput`: ink text `var(--color-text-primary)`, teal focus underline
  `var(--color-teal)`, filled underline `var(--color-border-strong)`, empty
  `var(--color-border)`, error `var(--color-danger)`; labels teal when active / muted at
  rest; autofill masking now insets `var(--color-surface-0)` (cream) instead of `#080D14`.
- City `<select>` and its options repainted on cream surface tokens.
- Step progress dots, plan cards, billing toggle, referral/promo blocks, order summary,
  tax rows, totals, consent checkboxes, error boxes, and both primary CTAs all moved to
  `var(--color-*)` tokens (teal / teal-deep / teal-soft, danger / danger-muted, brass for
  the "Top Centers" premium accent, text primary/secondary/muted, border/-strong/-brand).
- White text kept **only** on the two teal buttons and the radio dot (white-on-teal).
- The `data-chq-signup` attribute stays as an inert page marker (no CSS references it).

**`src/app/[locale]/accept-invite/page.tsx`** — full styling pass, logic untouched:

- Removed the `dark` class, the `bg-[#080f1a]` canvas, and `<LoginThemeEffect />`.
- Cream page, soft-white card (`var(--color-surface-1)`, `var(--color-border)`,
  `var(--shadow-md)`); Playfair step headings in ink; teal back-link / footer link.
- The "done" step's PIN panel repainted on `var(--color-surface-2)` with the PIN in
  `var(--color-teal)`; success check uses `var(--color-success)` on `-success-muted`.
- **`PhoneInput` and `OTPInput` were NOT modified** — they already resolve their colors
  through `var(--color-*)` and `hsl(var(--primary))` / `hsl(var(--destructive))`. In the
  light theme `--primary: 174 77% 24%` (dark teal) and `--destructive: 9 53% 37%` render
  legibly; the phone field (`+20` prefix, ink digits on `--color-surface-2`) and the six
  OTP boxes (bold ink digits, teal focus ring) read with strong contrast on cream —
  verified in the screenshots below.

**`src/app/[locale]/signup/layout.tsx`** — dropped `<LoginThemeEffect />` (now a passthrough).

**`src/app/globals.css`** — removed the remaining `[data-chq-signup]` locks: the token
lock, the `background/input/select/option/placeholder/autofill` `!important` overrides,
and the `html:has(...)` anti-flash canvas rule (replaced with "do not re-add" comments,
same convention as `[data-chq-login]`).

### Verification

Screenshots captured with the dev-server + Playwright method (`colorScheme` emulation,
`executablePath: /opt/pw-browsers/chromium`). Inputs are filled/focused so the phone
field and OTP boxes are visibly legible; the OTP step is reached by mocking the invite
`check` + Supabase `otp` network calls (a render-only trick — no app logic changed):

| Render | `<html>` | color-scheme | body bg | result |
|---|---|---|---|---|
| `/ar/signup` step 1 (fields filled, phone focused) | `(none)` | `light` | cream | **light** |
| `/ar/signup` step 2 (plan) / step 3 (payment) | `(none)` | `light` | cream | **light** |
| `/ar/signup` step 1 under **emulated dark OS** | `(none)` | `light` | cream | **light** |
| `/ar/accept-invite` phone step (filled `+20 …`) | `(none)` | `light` | cream | **light** |
| `/ar/accept-invite` OTP step (boxes `1 2 3 4 5`, 6th focused) | `(none)` | `light` | cream | **light** |
| `/ar/accept-invite` OTP step under **emulated dark OS** | `(none)` | `light` | cream | **light** |

Gates (all green, whole repo):

- [x] `next build` — compiled in ~52s, **394/394** static pages, exit 0.
- [x] Unit suite — **1147 passed / 141 files**.
- [x] `npm run typecheck` — clean.
- [x] `npm run lint` — **0 errors** (161 pre-existing warnings, all in untouched test files).
- [x] `verify:stabilization` — i18n (3832 keys, en/ar parity), bidi, tolocale all OK.

Logic diff: **styling/markup only.** A targeted `git diff` grep over the two rewritten
files shows **zero** changes to any line containing `fetch(`, `await`, `supabase`,
`router.`, `setState`/`setStep`/`setStage`/`setForm`, `signupStep1Schema`/`safeParse`,
`verifyOtp`/`signInWithOtp`, `persist(`, request `body`/`method`/`headers`, or field
`value`/`onChange`/`onSubmit`. `PhoneInput`/`OTPInput` are not in the diff at all.

---

## Reported for a later separate cleanup step (do NOT collapse in this build)

All three auth pages are now light. The following are fully inert and can be removed in a
dedicated follow-up:

1. **`src/components/LoginThemeEffect.tsx`** — now has **zero importers**; nothing ever
   adds `.dark` to the document root anymore. The file is left in place, unused.
2. **The `.dark` token blocks in `globals.css`** — the `html.dark` / `.dark` cascade is
   now dead app-side (no code path adds `.dark`). All `[data-chq-signup]` and
   `[data-chq-session-expired]` locks have been removed; only inert `data-chq-*` page
   markers remain on the elements.
3. **~54 files using `dark:` Tailwind variants** — inert app-side; safe to strip in the
   cleanup pass.

These are intentionally left in place in this build.

---

## Follow-up Item 1 — three English strings on the `/accept-invite` OTP step (FIXED)

The OTP step rendered three strings in English/broken Arabic. All three come from the
**`login`** i18n namespace, consumed by `src/components/OTPInput.tsx` (`useTranslations('login')`):

| Shown in screenshot | key | was (ar) | now (ar) |
|---|---|---|---|
| "Otp عنوان" (field title) | `login.otpTitle` | `"Otp عنوان"` | `"رمز التحقق"` |
| "Verify" (button) | `login.verify` | `"Verify"` | `"تأكيد"` |
| "Resend (60s)" | `login.resend` | `"Resend"` | `"إعادة إرسال الرمز"` |

Cause: the Arabic `login.*` values were machine placeholders, never translated. Fixed by
setting real Arabic values, reusing the wording already on this page/flow — "رمز التحقق"
matches `acceptInvite.sendOtp` ("إرسال رمز التحقق") and "تأكيد" matches
`teacherSignup.otpLabel` ("كود التأكيد"). The English side of `login.otpTitle` was also a
placeholder ("Otp Title") and was set to "Verification code"; `login.verify`/`login.resend`
were already correct English ("Verify"/"Resend") and were left as-is.

Scope: `login.otpTitle/verify/resend` are consumed **only** by `OTPInput`, which is rendered
**only** by `/accept-invite` (the `/join` flow uses its own `joinFlow.resend`). So this is a
contained wording change. **No OTP verify/send/resend logic, timer, or auth behaviour was
touched** — `messages/ar.json` + `messages/en.json` values only. ar/en key parity unchanged
(i18n gate green).

---

## Follow-up Item 2 — "رسوم الخدمة 6٪" service fee (INVESTIGATION ONLY — for Eyad)

**Nothing was changed. This is money; reported for a decision.**

**1. Where the 6% comes from.** Two independent places, both **pre-existing** (neither touched
by this redesign branch — see below):

- **The label text** is hardcoded in the i18n string `signup.serviceFee`
  (`"رسوم الخدمة 6٪"` / `"Service fee 6%"`). The "6%" is literally part of the translated
  string, not computed at render. On the signup summary it is paired with the value
  `signup.included` ("مشمول" / "Included") — it is shown as an *included* line, not an
  added-on line.
- **A matching real constant exists in the pricing engine**: `src/lib/pricing/taxMath.ts`
  defines `export const SERVICE_RATE = 0.06`, used in the tax gross-up
  `1 / ((1-VAT)(1-STAMP)(1-SERVICE))` (VAT 14% + stamp 0.5% + service 6%, cascading — the
  model described in `CLAUDE.md` / `docs/PRICING_SPEC.md`).

**2. Display-only, or does it affect the charged amount?** The label itself is display text —
editing that string changes no amount. But the **6% it describes is real in the pricing
engine**: `SERVICE_RATE` participates in converting between exclusive and tax-inclusive
amounts, so it is a genuine component *baked into* the plan's all-in price. On the signup
summary the amount charged is `getTotalAmount(...)` (the engine's all-in figure), and the 6%
is presented as **"included"** in that total — i.e. it is inside the price, not an extra charge
stacked at checkout. Net: the label is a faithful description of a fee the engine really
applies; the number is not invented at the UI layer.

**3. Pre-existing, or introduced by the redesign?** **Pre-existing — confirmed.**
- The `serviceFee` label string and the `taxKey: 'service'` summary row both predate this
  branch; the last change to them / to `taxMath.ts` was **commit `2af2e94` (PR #81, 17 Jun
  2026)**, long before this redesign.
- `git diff master..HEAD` for this branch touches **no** pricing/tax/fee file (only the four
  auth UI files + globals.css + this doc), and the `serviceFee` label string is **unchanged**
  on the branch. The redesign only recoloured that summary row (its value text `مشمول` turned
  teal); it did not touch the label, the value, or any amount.

**4. Plain read of what it represents.** The signup summary's "service fee 6%" is the
**service-fee component of the tax-inclusive gross-up** applied to the subscription plan price
(alongside VAT 14% and stamp 0.5%), shown as already included in the total. It appears to be a
**different fee from the "flat 20 EGP per invoice"** you referenced: that flat fee is a
separate, config-driven **processing fee** (`src/lib/processingFee.ts`
`PROCESSING_FEE_DEFAULT_AMOUNT = 20`, platform_config `processing_fee_amount`, default 20 EGP,
"Section 5"). So there seem to be **two distinct fees** in the system — a 6% service component
inside the plan tax gross-up, and a flat 20 EGP processing fee elsewhere — and the signup
summary surfaces the former.

**The open question for you:** is showing a "6% service fee (included)" on the signup summary
the intended customer-facing presentation, given the documented customer fee is a flat 20 EGP
per invoice? This is a pricing/presentation decision, so it is left untouched pending your call.
No pricing, fee, or billing value or logic was modified.
