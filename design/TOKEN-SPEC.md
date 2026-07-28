# TutoringHQ token specification

**Written 27 July 2026. This is the source of truth for the token layer.**

The 26 design files were drawn screen by screen over several weeks, and they drifted: 38 font sizes,
33 spacing values, 25 radii, 170 colours. That is not a system, it is a pile of literals. This
collapses them to a scale.

**Two things happen from this document.** The design files get regenerated against it, so the
drawings and the tokens agree. Claude Code wires it into the app, replacing Tailwind's defaults, so
the codebase is token-driven from day one.

---

## 1. Spacing

**4, 8, 12, 16, 24, 32, 48.**

Seven steps, from 33 distinct values. 66% of current spacing moves.

**Rounding is by role, not by nearest value.** This matters more than the scale itself.

| Role | Rounds | Why |
|---|---|---|
| `padding` | **up** | Card and panel interiors want generosity. 14 goes to 16, not 12. |
| `gap` | **down** | Lists and rows want tightness. 10 goes to 8, not 12. |
| `margin` | **down** | Same reasoning as gap. |
| `0` | **exempt** | A deliberate zero is not a spacing choice. 101 uses. |
| borders, hairlines | **exempt** | 1px and 2px borders are not spacing. |

A naive nearest-value snap tightens every card by 2px on each side while loosening every list. Role
based rounding moves them in the directions they each want.

**Tokens:** `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32,
`space-12` 48.

---

## 2. Type

**11, 12, 13, 15, 17, 22, 30, 44.**

Eight steps, from 38. 39% of uses shift, worst single jump 6px.

| Token | px | Uses | Role |
|---|---|---|---|
| `text-xs` | 11 | 849 | captions, meta, timestamps |
| `text-sm` | 12 | 1019 | secondary text, labels |
| `text-base` | 13 | 711 | body |
| `text-md` | 15 | 420 | row titles, emphasis |
| `text-lg` | 17 | 311 | section headings |
| `text-xl` | 22 | 132 | screen titles |
| `text-2xl` | 30 | 71 | display |
| `text-3xl` | ~~44~~ **30** | 105 | ~~reference-file mastheads only~~ **KPI values, display** — see correction below |

The distribution already had peaks at these values. The halves and neighbours were noise, not
intent.

### Correction, 28 July 2026 — `text-3xl` is 30, not 44

**Eyad's correction, on evidence found while wiring the token layer (PR #209).**

The 44 came from 105 uses in the design files, and those uses are almost entirely reference-file
mastheads — a thing that does not exist in the product. In the app the same token backs **KPI
figures**, in 14 places: the Center Home headline number, Benchmarks, the four teacher income
views, and `ScanResultScreen`. This table mapped a design-file role onto a product token and
conflated the two.

**`text-3xl` is 30px. That is the KPI value, and it is the only role this token has in the
product.** 44 is reference-file chrome and stays in the design files where it belongs.

There is deliberately **no second alias** for 44. One token, one meaning. If a real masthead ever
appears in the product it gets its own token then, on evidence rather than on speculation.

Known consequence, recorded rather than acted on: `text-2xl` and `text-3xl` are now both 30px, so
the ~20 `text-2xl md:text-3xl` pairs stop changing at the `md` breakpoint. Nothing breaks — the
responsive step flattens. Whether the two names collapse into one is a restyle decision, not a
token one.

**A nine-step scale was tested and rejected.** It reduced the worst jump by nothing and the widest
buckets are at 30 and 44, where the values are one-off page titles rather than a working scale.

### The Arabic allowance

**IBM Plex Sans Arabic reads smaller than IBM Plex Sans at the same px.** Arabic letterforms carry
more detail in the same optical space, and at 11px the difference between readable and squinting.

**Arabic frames use one step up from English for body text and below**, meaning `text-xs` through
`text-base`. Headings and display sizes are unchanged, because at 17px and above the difference
stops mattering.

This is not a per-screen decision. It belongs in the token layer as a language-conditional value, so
nobody has to remember it.

---

## 3. Radii

**4, 8, 12, 16, 24, pill.**

Six steps, from 25.

| Token | px | Uses | Role |
|---|---|---|---|
| `radius-xs` | 4 | 55 | inline chips, small marks |
| `radius-sm` | 8 | 226 | inputs, small buttons |
| `radius-md` | 12 | 592 | cards, rows, the default |
| `radius-lg` | 16 | 214 | panels, sheets |
| `radius-xl` | 24 | 319 | large surfaces, modals |
| `radius-pill` | 999 | 415 | pills, badges, avatars |

**Exempt: 34 and 44.** Those are the phone screen and bezel in the reference files. They are not UI
radii and must not become tokens.

---

## 4. Colour

**170 distinct hexes collapse to 18 named tokens.** This is the largest cleanup in the document and
the one most likely to be resisted mid-build, because a near-match always looks close enough.

| Token | Hex | Role |
|---|---|---|
| `paper` | `#ECE8DF` | app background |
| `panel` | `#FFFDF8` | cards, raised surfaces |
| `tile` | `#F2EEE5` | recessed surfaces, quiet fills |
| `canvas` | `#D8D3C6` | reference-file background only |
| `line` | `#E2DDD1` | borders |
| `hairline` | `#F0ECE2` | internal dividers |
| `ink` | `#14181A` | primary text |
| `ink-body` | `#3A3F3A` | body text |
| `mid` | `#5D635C` | secondary text |
| `muted` | `#80827A` | tertiary text, meta |
| `faint` | `#A09A8E` | placeholders, disabled |
| `accent` | `#0E6B61` | primary action |
| `accent-deep` | `#0A514A` | pressed, text on mint |
| `mint` | `#DFEEEB` | accent fill |
| `mint-deep` | `#BFE3DD` | accent border |
| `ground` | `#083F39` | darkest teal, gradients |
| `brass` | `#9A6B1F` | warning, attention |
| `sand` | `#F4EBD7` | warning fill |
| `danger` | `#9C3322` | destructive, error |

**Casing was inconsistent in the source**, `#9C3322` and `#9c3322` both appear. Tokens are
lowercase in code, uppercase in this document for readability. Same colour.

Anything not in this table is a drift and gets mapped to its nearest token, not preserved.

---

## 5. What this does not change

- **Fonts.** IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex Mono. Unchanged.
- **The rule that Mono is dropped on Arabic frames** in favour of weight 600. Unchanged.
- **Eastern Arabic numerals on Arabic frames, Western on English.** Unchanged, and it is not a token, it is a formatting-layer concern.
- **Light only.** The `color-scheme: light` declaration and the light root background stay on every file.
- **The two frame conventions**, 340px phone and 412px marketing bezel. Reference-file structure, not product tokens.

---

## 6. Order of work

1. **Regenerate the 26 design files against this spec.** Done in the design chat, where the render harness and verification scripts already exist. The drawings then speak in tokens and no conversion table is needed.
2. **Claude Code wires the token layer into the app**, replacing Tailwind's defaults. One PR, alone, because every screen shifts the moment it lands.
3. **Screens get restyled against it**, one merged file at a time.

Step 2 is where the redesign actually begins. Nothing before it changes how anything looks.

---

## 7. The honest caveat

**Regenerating changes the designs.** 66% of spacing and 39% of type moves. Cards get slightly more
generous, lists get slightly tighter, and the smallest text nudges up.

That is the point of adopting a scale, and it is why it happens now rather than after 105 screens
are built against the drift.
