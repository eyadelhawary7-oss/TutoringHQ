# Internationalization Setup Guide

> Synced against the live database and code on 2026-07-18. Facts verified live are marked (verified 2026-07-18).

This Next.js App Router project is configured with full internationalization support using `next-intl` 4.

## Features

✅ **Arabic (ar) as default language** with RTL support
✅ **English (en) as secondary language**
✅ **Fonts** (verified live 2026-07-18 against `src/app/[locale]/layout.tsx` + `src/app/globals.css`): the product font is **IBM Plex Sans Arabic** (Arabic **and** Latin in one face, ADR 031), loaded via `next/font/google` and wired as `--font-plex` → `--font-sans`/`--font-mono`. Self-hosted **`Cairo-Arabic`** (woff2 via `next/font/local`, copied from `@fontsource/cairo` by `npm run setup-fonts`) is a unicode-range Arabic fallback while Plex loads. Display faces Playfair Display, Bodoni Moda and Fraunces (`next/font/google`) are used for marketing/summer surfaces. JetBrains Mono woff2 **is copied** to `public/fonts/` by `setup-fonts` but is **not currently wired** to any `font-family` (`--font-mono` resolves to Plex/Cairo-Arabic — grep finds zero `jetbrains` references in `src/`). No Inter font is used. `next/font` self-hosts at build, so nothing is fetched from Google Fonts at runtime.
✅ **Language toggle** with localStorage persistence
✅ **Tailwind CSS logical properties** for RTL-aware layouts
✅ **Locale routing** with an always-on locale prefix (`localePrefix: 'always'`)

## Project Structure

```
├── messages/
│   ├── ar.json          # Arabic translations
│   └── en.json          # English translations
├── src/
│   ├── app/
│   │   ├── [locale]/    # Locale-specific pages
│   │   │   └── page.tsx
│   │   ├── layout.tsx   # Root layout with locale support
│   │   └── globals.css  # @font-face declarations live here (verified 2026-07-18)
│   ├── components/
│   │   └── LanguageToggle.tsx  # Language switcher
│   ├── i18n/
│   │   ├── request.ts   # next-intl configuration
│   │   └── routing.ts   # Routing configuration (defaultLocale 'ar', localePrefix 'always')
│   └── proxy.ts         # Middleware — aliased `proxy.ts`, NOT `middleware.ts` (verified 2026-07-18)
```

> Note: there is no `src/components/Navbar.tsx` and no `src/lib/fonts.ts` (both verified absent 2026-07-18). Font wiring lives in `src/app/globals.css` (`@font-face`) plus `scripts/setup-fonts.mjs` (copies woff2 from `@fontsource`).

## Usage

### Adding New Translations

Add translations to both `messages/ar.json` and `messages/en.json`:

```json
{
  "common": {
    "welcome": "مرحبا" // or "Welcome"
  }
}
```

### Using Translations in Components

```tsx
import { useTranslations } from 'next-intl';

export default function MyComponent() {
  const t = useTranslations('common');
  return <h1>{t('welcome')}</h1>;
}
```

### Creating Links

Use the localized `Link` component from `@/i18n/routing`:

```tsx
import { Link } from '@/i18n/routing';

<Link href="/dashboard">Dashboard</Link>
```

### RTL-Aware Styling with Tailwind

Use logical properties instead of directional properties:

| ❌ Don't Use | ✅ Use Instead | Description |
|-------------|----------------|-------------|
| `ml-4` | `ms-4` | Margin inline start |
| `mr-4` | `me-4` | Margin inline end |
| `pl-4` | `ps-4` | Padding inline start |
| `pr-4` | `pe-4` | Padding inline end |
| `left-0` | `start-0` | Inset inline start |
| `right-0` | `end-0` | Inset inline end |
| `text-left` | `text-start` | Text alignment |
| `text-right` | `text-end` | Text alignment |

### Language Toggle

The `LanguageToggle` component (`src/components/LanguageToggle.tsx`, verified present 2026-07-18):
- Saves the selected language to localStorage
- Persists across page reloads

### Font Configuration (verified 2026-07-18)

- **Primary (Arabic + Latin)**: **IBM Plex Sans Arabic** via `next/font/google` (`--font-plex`), the single product face for both scripts (ADR 031). It backs both `--font-sans` and `--font-mono` in `src/app/globals.css`.
- **Arabic fallback**: self-hosted `Cairo-Arabic` (woff2, `next/font/local`, unicode-range restricted to Arabic glyphs) — shown only while Plex loads.
- **Display faces**: Playfair Display, Bodoni Moda, Fraunces (`next/font/google`) for marketing/summer surfaces only.
- **Monospace**: there is no dedicated mono face wired — `--font-mono` resolves to Plex/Cairo-Arabic. JetBrains Mono woff2 is copied into `public/fonts/` by `scripts/setup-fonts.mjs` but is **not referenced** by any `font-family` (verified: zero `jetbrains` hits in `src/`).
- `next/font` self-hosts its fonts at build time; the self-hosted Cairo woff2 comes from `@fontsource/cairo` via `npm run setup-fonts`. Nothing is fetched from Google Fonts at runtime.

## How It Works (verified 2026-07-18)

1. **Middleware** (`src/proxy.ts`, aliased `proxy.ts`) runs `next-intl` locale routing (plus tenancy/auth — see `CLAUDE.md`).
2. **Root Layout** (`src/app/[locale]/layout.tsx`) sets `dir="rtl"` for Arabic and applies the correct font.
3. **Routing** is handled by `next-intl` with locale prefixes (e.g., `/ar/dashboard`, `/en/dashboard`).
4. **The locale prefix is ALWAYS shown** — `routing.ts` sets `localePrefix: 'always'`, so the prefix is never stripped (this deliberately prevents `/ar/login` → `/login` redirects).

## URLs (verified 2026-07-18)

- `/` → Redirects to `/ar` (default locale)
- `/ar` → Arabic version (prefix always present)
- `/en` → English version
- `/ar/dashboard` → Arabic dashboard
- `/en/dashboard` → English dashboard

## Adding New Locales

To add a new locale (e.g., French):

1. Create `messages/fr.json`
2. Update `src/i18n/routing.ts`:
   ```ts
   export const routing = defineRouting({
     locales: ['ar', 'en', 'fr'],
     defaultLocale: 'ar',
   });
   ```
3. Add any needed `@font-face` declarations in `src/app/globals.css` and, if pulling from `@fontsource`, extend `scripts/setup-fonts.mjs`
4. Update layout logic for font/direction handling

## Development

```bash
npm run dev
```

Visit:
- `http://localhost:3000` (default: Arabic)
- `http://localhost:3000/en` (English)

## Learn More

- [next-intl Documentation](https://next-intl-docs.vercel.app/)
- [Next.js Internationalization](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [Tailwind CSS Logical Properties](https://tailwindcss.com/docs/margin#logical-properties)
