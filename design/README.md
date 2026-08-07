# design/

**25 merged HTML files. 110 screens. 499 frames.** Regenerated 6 August 2026; frame count updated
7 August 2026 when the four `verified` frames in `Merged-Teacher-Setup` and `Merged-Teacher-Home`
were dropped, the two-state account model having ceased to exist. Screens are unchanged.

This folder is the source of truth for what every screen looks like and what logic sits behind it.

---

## What is in here

| File | Purpose |
|---|---|
| `Merged-*.html` | 25 files. The screens themselves. |
| `NEW-MODEL.md` | The InstaPay model. What died, what replaced it, and the logic underneath. |
| `NEW-FEATURES.md` | Every feature added on 6 August, with its rules and where its screens live. |
| `MERGED-FILE-MAP.md` | Which screens live in which file. |
| `TOKEN-SPEC.md` | The design scale. Spacing, type, radii, colour. |
| `tutoringhq-public-design-system.md` | The public surface: components, copy rules, page patterns. |
| `SPEC-instapay-fee-collection.md` | Fee collection mechanics. Authoritative on the flow. |

---

## Read this before building anything

**The model changed on 6 August.** Identity verification, online collection through a gateway,
platform payouts, the 90/10 split and the percentage markup are all gone. Not deferred, gone.

Anything built against them is invalid. `NEW-MODEL.md` says what replaced them.

---

## How to read a merged file

**CSS is scoped with `.mgdN`.** Strip it. It never reaches code.

**One section is one screen.** The bar above each carries its number, name, and source file.

**Frames are states, not pages.** Four frames under one screen usually means two states in two
languages, not four screens.

**The two languages are separate screens, not a toggle.** Arabic frames mirror in RTL, use Eastern
Arabic numerals, and drop IBM Plex Mono for weight 600. Arabic body text sits one step up the type
scale, because Plex Sans Arabic reads smaller at the same pixel size. Do not build one and flip it.

**Sample data is placeholder.** Names, amounts and dates are illustrative. Never ship them.

**Any UI change bumps `SW_VERSION` in `public/sw.js`.**

---

## The bar these screens are held to

**Visually identical, not equivalent.** Sections the design lacks get removed, not kept alongside.
Sections the design has appear in the design's order. The screen is replaced with the design, not
patched toward it.

**Omission is for missing DATA, never missing effort.** Before omitting anything, check the catalog
to confirm the data genuinely does not exist. That mistake produced a screen at 15% of its design
reported as complete.

**Never fabricate data to fill a design.** A plausible fake number is worse than a visible gap,
because nobody questions it afterwards.

**Report a fraction, never "done."**

---

## Protected files

These carry money or auth. They never auto-merge and every PR comes to Eyad regardless of size.

`Merged-Public-App` · `Merged-Center-Money` · `Merged-Teacher-Money` · `Merged-Admin-Money` ·
`Merged-Lifecycle` · `Merged-Design-Patterns`

`Merged-Verification-Payouts` was the seventh. It is deleted, because identity verification and
platform payouts both ceased to exist.
