# TutoringHQ - Design system

**Extracted from the two screens already built**, `Screen-Public-Landing` and `Screen-Public-Join`, so the remaining screens match rather than approximate. Every value here is copied from working code, not invented.

Build `Screen-Public-Auth` and `Screen-Public-Pricing` against this file.

---

## 1. Non-negotiables

1. **Each language stands alone.** English frames are 100% English with Latin numerals and EGP. Arabic frames are 100% Arabic with Eastern numerals and ج.م. Neither is a translation of the other; the Arabic is written.
2. **The only Latin on an Arabic frame** is the TutoringHQ wordmark and the language switcher. The only Arabic on an English frame is the switcher label عربي, which is correct because a switcher names its target language in its own script.
3. **Never show a percentage cut** on any public page. There is none. Plans and income potential only.
4. **No role gate.** The root URL shows a page, never a question.
5. **One animated thing per page**, and it is the session-row stack. Everything else holds still.
6. **No dashboard screenshots, no angled laptops, no three feature cards with icons.**
7. **"Center", never the British spelling.**
8. **The parent is not a user.** No signup path is ever offered to them.

---

## 2. Tokens

```
paper        #ECE8DF   page background
panel        #FFFDF8   cards, rows, fields
tile         #F2EEE5   inset blocks, secondary buttons
line         #E2DDD1   all borders
hairline     #F0ECE2   dividers inside a card
ink          #14181A   display type and phone bezel
ink-body     #3A3F3A   paragraph text
muted        #80827A   labels, secondary
faint        #A09A8E   placeholders, disabled
accent       #0E6B61   primary buttons, ticks
accent-deep  #0A514A   text on mint, gradient end
mint         #DFEEEB   accent backgrounds, confirmed chips
ground       #083F39   dark gradient end
brass        #9A6B1F   kickers, warnings, the cash motif
sand         #F4EBD7   warning backgrounds
good         #1A6D4D   paid, success text
danger       #9C3322   declined, destructive
```

**Gradients.** Accent panel `linear-gradient(155deg,#0F766B,#083F39)`. Brand mark `linear-gradient(150deg,#0F766B,#083F39)`. Dark footer block is flat `#14181A`.

**Page background** for the reference board, not the screens:
```css
background:#d8d3c6;
background-image:
  radial-gradient(1100px 700px at 82% -10%, rgba(14,107,97,.10), transparent 60%),
  radial-gradient(1000px 700px at 8% -8%, rgba(154,107,31,.10), transparent 60%);
```

---

## 3. Type

**Three faces, three jobs.**

| Face | Weight | Job |
|---|---|---|
| IBM Plex Sans Arabic | 400–700 | All Arabic. Carries the personality at display sizes. |
| IBM Plex Sans | 400–700 | All English, plus the wordmark in both languages. |
| IBM Plex Mono | 400–500 | The ledger voice: prices, codes, IBANs, times, step numbers. |

**The mono rule.** Mono is a *voice*, not decoration. It is what makes a row read as a record rather than a list item. Use it for anything that would appear in a ledger. **On Arabic frames, mono is dropped** for prices and numbers, because Eastern numerals in Plex Mono read poorly. Instead use `font-family:inherit; font-weight:600` or `700`, which is already handled by the `.ar` overrides.

**Scale as built.**

| Role | English | Arabic |
|---|---|---|
| Hero | 34px / 1.18 / -.015em | 36px / 1.22 / 0 |
| Section head | 24px / 1.28 / -.01em | 25px / 1.28 / 0 |
| Confirmation title | 22px / 1.3 | same |
| Card title | 19–21px / 1.3 | same |
| Body | 13.5px / 1.6 | same |
| Sub / lead | 13–14.5px / 1.5 | same |
| Label, uppercase | 11px / .03em tracking | 11px / .02em |
| Kicker, uppercase | 11px / .11em tracking | 11px / .02em |
| Hint, meta | 10.5–11.5px / 1.45 | same |

**Arabic loses tracking.** Every `letter-spacing` above zero is reset to `0` or `.02em` on `.ar`. Negative tracking on Arabic display type is wrong and looks broken.

---

## 4. Frame anatomy

Every reference screen is a standalone `.html` file with this skeleton.

```html
<div class="frame">
  <div class="phone"><div class="screen">        <!-- add class="ar" dir="rtl" for Arabic -->
    <div class="sbar">…</div>                    <!-- status bar, 44px -->
    <div class="brand">…</div>                   <!-- or .nav on marketing pages -->
    <div class="body">…</div>                    <!-- the only scrolling region -->
    <div class="footer">…</div>                  <!-- optional, sticky -->
  </div></div>
  <div class="cap">EN · what this frame is</div>
</div>
```

**Exact primitives, copy these:**

```css
.phone  { width:340px; background:#14181a; border-radius:44px; padding:11px;
          box-shadow:0 30px 60px -20px rgba(0,0,0,.4) }
.screen { background:#ece8df; border-radius:34px; height:748px;
          display:flex; flex-direction:column; overflow:hidden; position:relative }
.sbar   { height:44px; display:flex; align-items:center; justify-content:space-between;
          padding:0 24px; font-size:14px; font-weight:600; flex-shrink:0 }
.brand  { display:flex; align-items:center; gap:8px; padding:2px 18px 14px; flex-shrink:0 }
.mark   { width:22px; height:22px; border-radius:7px;
          background:linear-gradient(150deg,#0f766b,#083f39); flex-shrink:0 }
.body   { flex:1; overflow-y:auto; padding:0 18px 18px }
.footer { padding:11px 18px 18px; border-top:1px solid #e2ddd1;
          background:#ece8df; flex-shrink:0 }
```

**Status bar content.** English `9:41` and `••• ▾ ▮`. Arabic `٩:٤١` and `▮ ▾ •••`, mirrored.

**Marketing pages use `.nav` instead of `.brand`**, which adds a right-side group holding a nav link and the language switcher.

---

## 5. Components as built

### The session row, the signature

The atom every screen in the product is built from: one student, one session, one price, one state. **Use it wherever a session, a payment or a student appears.** It is what makes the public surface look like the product.

```html
<div class="srow paid">          <!-- omit .paid for pending -->
  <div class="sav">MH</div>       <!-- initials, 32px, 10px radius -->
  <div class="sn">
    <div class="snm">Mariam Hassan</div>
    <div class="ssub">Physics · Sun 4PM</div>
  </div>
  <div class="spr">
    <div class="spv">168.75</div> <!-- mono in EN, inherit+600 in AR -->
    <div class="sst">PAID</div>
  </div>
  <div class="stick">✓</div>      <!-- or .sdot, a dashed ring, for pending -->
</div>
```

Paid rows take `border-color:rgba(14,107,97,.3)` and `background:#F6FAF9`; the avatar turns mint, the status turns `#1A6D4D`, and the ring becomes a filled accent tick. Pending keeps the plain panel and a dashed `#CFC9BB` ring.

**The one animation on any page** is a short stack of these resolving from pending to paid. Nothing else moves.

### The provider card

Used on Join and reusable on Auth and Pricing wherever a center or teacher is named.

`.who` panel → `.wtop` (46px `.wav` avatar, `.wnm` name, `.wrole` beneath) → `.wdiv` hairline → `.glab` uppercase brass label → `.gnm` 19px title → `.gmeta` two-column meta.

### Form field

```html
<div class="flab">PARENT PHONE</div>
<div class="field"><div class="fv ph mono" dir="ltr">+20 1_ ____ ____</div></div>
<div class="fhint"><b>Required.</b> Why it matters, in one sentence.</div>
```

`.field` is panel on line with 13px radius. `.fv.ph` is the placeholder state at `#B6B1A4`. **Phone numbers and codes always carry `dir="ltr"` and mono**, even inside an RTL frame. `.fhint` bold runs in brass and carries the reason, never a bare asterisk. Optional fields append `<span class="fopt">OPTIONAL</span>`.

### Guard note

```html
<div class="guard">Nothing is billed and no attendance exists until the center approves you.</div>
```

Mint on accent, 11.5px, 1.55 line height. **This exact sentence is required on the Join form and the Join confirmation**, and it is the same sentence the approver reads on their side of the handshake. Use `.guard` for any reassurance that removes a fear.

### Confirmation screen

`.okwrap` centers everything vertically. A 66px `.okic` circle (mint for success, sand for a problem), `.okt` 22px title, `.oks` 13.5px body capped at 31ch, then an `.okcard` of `.okrow` key-value pairs, then `.okfoot` at 11px capped at 32ch.

**A problem state is not an error state.** A closed link or a used trial explains what probably happened and offers a way forward. Sand and brass, never red.

### Buttons

`.btn` is full-width, 13px radius, 15px/700, accent on paper. `.btn.ghost` is panel with a line border and muted text at 13.5px for the secondary action. `.fnote` above a button carries the one-line consequence in 10.5px muted.

---

## 6. Copy rules

**Say the concrete thing.** "A wrong number means sessions that cannot be paid for," not "please enter a valid number." The specific version converts and the generic one is ignored.

**Name the reason next to the requirement.** Required fields carry their justification, not an asterisk.

**Never mock how they work today.** The notebook, the cash in the drawer and the four-times-rewritten message are named plainly, because the people reading built working businesses that way. The line between honest and condescending is thin and it matters.

**Kickers are uppercase brass**, four words at most, and they orient rather than sell.

**The Arabic is Egyptian colloquial, not formal standard**, because the reader is a teacher and not a ministry. It should read as written by someone rather than translated by someone.

**Numbers are exact.** 168.75, never "about 170". The mono face exists to make exactness legible.

---

## 7. RTL rules

- `dir="rtl"` on `.screen`, plus `class="ar"` to switch the face and reset tracking.
- **Logical properties everywhere.** `margin-inline-start`, `padding-inline-end`, `text-align:start`. Never `left` or `right`.
- **Chevrons flip.** `M9 18l6-6-6-6` in LTR, `M15 18l-6-6 6-6` in RTL. An LTR chevron in an Arabic frame points back the way you came.
- **The status bar mirrors.** Signal cluster moves to the start side.
- **Numerals convert.** ٠١٢٣٤٥٦٧٨٩, thousands ٬, decimal ٫, currency ج.م after the number.
- **Latin islands stay LTR.** Phone numbers, IBANs, codes and the wordmark keep `dir="ltr"`.

---

## 8. How the design is filed

**25 merged files, 110 screens.** Index in `MERGED-FILE-MAP.md`. Every single screen also survives
on its own. The merged files are the only source now.

Each merged file is one standalone page: a title block, a table of contents, then one numbered
section per screen. Every file opens with a comment block for whoever implements it.

**CSS in a merged file is scoped.** Every rule carries a `.mgdN` prefix so several screens can share
one page without their styles colliding.

```
in the merged file:   .mgd4 .pins { ... }
in your code:         .pins { ... }
```

The prefix is bookkeeping for the reference file. **It must never reach the codebase.**

**Every file declares itself light only.** A `color-scheme: light` meta tag plus a real light
background on the root element. Without both, a phone in dark mode darkens the canvas while the text
stays dark, and the screen goes black. This was a real bug, not a precaution.

---

## 9. Frame conventions

Two, and they mean different things.

**Phone frames** are app screens. A 340px bezel around a 748px screen. Each phone is one *state* of
a screen, not a page: empty, filled, error. The caption names the state.

**Marketing pages** are long scrolling web pages a stranger reads in a browser. They sit in a wider
412px bezel around the same 748px screen, with the page scrolling inside it. Landing is 4,443px of
content, Audience 5,316px, Pricing 3,987px, so at rest you see the top of each one.

Known trade off, accepted 25 July 2026: checking the full price ladder in one pass now takes
scrolling. It was chosen over a very tall bezel so that every screen in the set reads at the same
size.

---

## 10. PIN

**Six digits, everywhere.** The app lock screen once said four; it does not any more.

**Both PIN surfaces carry a show toggle.** An eye that reveals the digits.

- Borderless and muted, never a boxed button. It sits clear of the field so it does not read as another digit.
- Masked by default. Turns teal and switches to a crossed out eye while revealed.
- At least a 32px tap target.
- The revealed state is never logged or persisted.

Applies to all four Auth fields (set, confirm, login, wrong PIN) and to the app lock PIN.

A six digit PIN typed one handed with no visible feedback produces typos that look like failed
logins, and a locked account is a support call.

---

## 11. Codes and phishing

Two places send a one time code: account signup, and self enrollment into a group.

Both screens state plainly that this is the only code the platform will ever send, and that
attendance and fees never ask for a code. **This copy is not decoration and should not be trimmed.**
A family told this once is much harder to phish later.

Ten minute expiry, newest code only, resend on a visible countdown.

---

## 12. What is not built

Nothing. Every route has a screen and every link has a destination.

Five pages were dropped rather than built, because nothing linked to them: `/blog`, the three
`/features/*` pages, and `/compare/spreadsheets`. The persona splash at `/` was killed earlier.
`/demo-request` is not a screen; it is the WhatsApp link plus the lead capture form.
