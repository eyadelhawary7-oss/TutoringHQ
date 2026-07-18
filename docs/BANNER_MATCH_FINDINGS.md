# Step 0 — Findings: make the LIVE summer ribbon + popup match the approved mock

> HISTORICAL Step-0 record, synced against the live database and code on 2026-07-18. **The master switch state has flipped since this was written:** `summer.promo.enabled` is now **true** live (verified live 2026-07-18) — the ribbon + popup gate is ON, so the sentences below stating "It is OFF now → live page stays clean" are stale (corrected inline). Still current live: `summer.first_charge_release` = **HELD**, `summer.first_charge_floor` = **2026-08-30**, `summer.pay_window_days` = **1** (verified live 2026-07-18). Component/copy findings are preserved as the point-in-time record.

Introspection before any code, per the build brief. Conclusion up front: **the ribbon and
popup components already exist and are already mounted on all three public pages.** This is a
*styling + behaviour correction* of the existing components, not a second banner. Nothing here
stands up a parallel surface.

> **Mock file is absent.** `summer_promo_v2_inbrand.html` is **not** in the repo or git history
> (same as noted in `docs/SUMMER_2026_FINDINGS.md`). The single source of truth I have is the
> set of *exact literal values* enumerated in the build brief. I match those values verbatim.
> One detail the brief under-specifies — the popup CTA colour ("cream button" on a cream card —
> visually self-cancelling) — is called out below as an assumption to confirm from the review
> screenshots.

---

## 1. Where the components live

| Concern | File |
| --- | --- |
| Ribbon component | `src/components/summer/SummerRibbon.tsx` |
| Popup component | `src/components/summer/SummerPopup.tsx` |
| Shared client config hook | `src/components/summer/useSummerPublicConfig.ts` |
| Per-portal copy + accent | `src/lib/summer/copy.ts` |
| Public config endpoint | `src/app/api/pricing/public-config/route.ts` (→ `getSummerConfig`, `getPopupConfig`) |
| Summer master switch + dates | `src/lib/summer/config.ts` (`platform_config` keys, default **OFF**) |

**Mount points (both ribbon and popup, all three portals):**

- Combined / home — `src/app/[locale]/HomePageClient.tsx` (`portal="combined"`)
- Front-door splash — `src/app/[locale]/SplashClient.tsx` (`portal="combined"`)
- Teacher landing — `src/app/[locale]/teacher/landing/TeacherLandingClient.tsx` (`portal="teachers"`)

A dedicated `portal="centers"` page reuses the combined ribbon path; the centers accent equals the
combined accent, so the green ribbon is correct there too.

---

## 2. Why the ribbon colour comes out muted (the "muddy grey-green")

Not a theme-token problem — `summerAccent()` already returns the literal `#2e5a4c`. The colour is
correct *as a value*; it reads washed-out for two compounding reasons:

1. **No gradient.** The ribbon paints a single flat `backgroundColor: #2e5a4c`. The mock is a
   `linear-gradient(160deg, #2e5a4c → #244a3e)`. A flat mid-green next to the mock's depth-graded
   ribbon reads noticeably flatter/greyer.
2. **A translucent, blurred header paints on top of it (combined/home only).** In
   `HomePageClient.tsx` the site header is `fixed … top-0 z-50` with
   `bg-[var(--color-surface-1)]/90 backdrop-blur-md`. The ribbon is `sticky top-0 z-50`. Same
   stacking context, header later in the DOM → the frosted, semi-transparent header is layered
   over the ribbon's top edge, literally desaturating it through the blur. That is the most direct
   cause of "grey-green" specifically on the live home page.

Fix: paint the exact 160° gradient (full-strength literal hex, **not** routed through a muted theme
token), and let the ribbon sit cleanly (it already does on splash/teacher pages, which have a
non-fixed header).

Secondary mismatch: the headline uses `var(--font-playfair)`, but the mock specifies **Fraunces**.
Fraunces is **not** wired in `layout.tsx` today (only Playfair, Bodoni, Cairo, Plex). It must be
added via `next/font/google` as `--font-fraunces`.

---

## 3. Why the popup "isn't rendering" / doesn't match

The popup **is** mounted on all three pages and **is** correctly gated on the master switch
(`useSummerPublicConfig` returns `null` while summer mode is OFF, so the component early-returns —
which is why the live page was clean while the switch was OFF; the switch is **ON** as of 2026-07-18
(see the banner and §5), so the popup now renders). So it is not a missing
mount. What's wrong:

1. **Wrong form factor.** The current popup is a **centred modal over a `bg-black/40` full-screen
   overlay**. The mock is an **in-brand cream card that slides up from the bottom** — a much
   smaller, non-blocking surface. Against the mock it reads as "the popup isn't there" because the
   thing that shows is a different component shape entirely.
2. **Missing mock chrome.** No "☀︎ Summer offer" tag, no compact inline `__d __h __m` countdown in
   the top row, no `No card now · First invoice Aug 30` footer line.
3. **Wrong font.** Same Playfair-vs-Fraunces issue as the ribbon.
4. Per-portal H2 text doesn't match the mock's portal headings (`Free all summer` /
   `Your center, free all summer` / `Your groups, free all summer`).

Cookie/once-per-visitor behaviour is already correct (non-PII `chq_summer_popup` cookie, no
localStorage) and is preserved.

---

## 4. The code chip (reversed decision — now SHOWN)

The earlier build deliberately omitted the chip ("summer mode is automatic"). The founder has
reversed this: the chip is now shown on every portal ribbon. Constraints honoured:

- **Display/marketing only.** Summer mode stays fully automatic; the chip does not gate signup and
  the visitor never has to type the code. No change to any signup/billing flow.
- **Source of the code:** the already-seeded shared code lives in `platform_config` as
  `landing.popup.promo_code`, surfaced publicly as `popup.promoCode` by `/api/pricing/public-config`.
  The hook is extended to read it; the chip renders it and copies it to the clipboard with a brief
  check-tick. If the config code is empty, the chip is simply not rendered (no empty pill).

---

## 5. Behaviour that must NOT change (verified, preserved)

- Ribbon + popup appear **only** when `summer.promo.enabled` is ON. (At the time of writing it was
  OFF; it is **ON** as of 2026-07-18 — verified live, so the ribbon + popup now render.) The master
  switch hides/shows **both** together (single gate via `useSummerPublicConfig`).
- No charge logic touched. The Aug-30 first-charge `HELD` flag (`summer.first_charge_release`) is
  untouched — it lives entirely server-side and is never surfaced here.
- Africa/Cairo for all date math (countdown target via `startOfUtcInstantForCairoCalendarDay` on
  `summer.first_charge_floor`). Arabic-first RTL, logical CSS props only (`start`/`end`).

---

## 6. Build plan (front-end only — no DB, no migration)

1. `src/app/[locale]/layout.tsx` — wire **Fraunces** via `next/font/google` → `--font-fraunces`.
2. `src/lib/summer/copy.ts` — per-portal headline + sub + popup H2 (exact brief copy, AR mirrored);
   add gradient/CTA-colour/chip-label/offer-tag/footer helpers.
3. `src/components/summer/useSummerPublicConfig.ts` — also expose the shared `promoCode`.
4. `src/components/summer/SummerRibbon.tsx` — 160° gradient, Fraunces headline + sub, cream CTA,
   dashed copy-chip with tick.
5. `src/components/summer/SummerPopup.tsx` — bottom slide-up cream card, offer tag + inline
   countdown + close, Fraunces H2, footer line.
6. `tests/unit/summerCopy.test.ts` — update assertions to the new copy structure; keep suite green.

Then build on `claude/summer-banner-popup-match-qlsoqz`, push, **hold for review** — no PR until the
founder approves screenshots.

### Assumption pending the missing mock
The brief lists the popup CTA as a "cream button," but the popup card is itself cream. I render the
popup CTA as a **solid accent (forest-green / gold) button with cream text** — legible, in-brand,
and the mirror of the ribbon's cream-on-green CTA. Flag for confirmation against the mock screenshot.

---

## 7. Follow-up fix note (round 2)

Three small corrections on the same branch — front-end only, no DB/migration, switch still OFF.

1. **Name leak removed + popup copy matched verbatim.** The popup body said "Use CenterHQ …".
   CenterHQ is the internal name; only **TutoringHQ** is ever customer-facing. All summer popup
   bodies (EN + AR, every portal) are replaced with the approved mock copy. A safety sweep across
   landing pages, ribbon, popup, `messages/*.json`, emails (`invoiceTemplates.ts`), and metadata
   found **no other customer-visible "CenterHQ"** — the remaining hits are code comments, console/
   Sentry log labels, internal identifiers (`@centerhq.local`, repo/Vercel names), and tests, all
   correctly left untouched. A unit test now guards that summer copy never contains "CenterHQ".
2. **Code chip now appears.** The seeded `landing.popup.promo_code` is empty on live, so the chip
   was hidden. Added `SUMMER_PROMO_CODE = 'SUMMER26'` as the front-end fallback (a config value
   still wins if set later). The ribbon now shows `Code SUMMER26` on all three portals; copy works.
   Display-only — it does not gate signup.
3. **Centers ribbon no longer clipped.** `/center` renders `HomePageClient`, whose header was
   `fixed top-0 z-50` — it overlaid the `sticky top-0` ribbon, leaving only the CTA visible. Changed
   the header to `sticky top-0` (exactly what the combined/teacher pages use) so the full ribbon
   sits above it, and trimmed the hero's now-redundant top padding (`pt-24 md:pt-28` → `pt-8 md:pt-14`).
   Also corrected this page's ribbon/popup `portal` from `combined` → `centers`, so it shows the
   centers copy ("Run your center free all summer") as the mock intends.
