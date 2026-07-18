# Quick Start Guide - Internationalization

> Synced against the live database and code on 2026-07-18. Facts verified live are marked (verified 2026-07-18).

Your Next.js project is configured with internationalization.

## What's Been Set Up

✅ **next-intl** 4 library integration
✅ **Arabic (ar)** as default language with RTL support
✅ **English (en)** as secondary language
✅ **Fonts** (verified live 2026-07-18): product font is **IBM Plex Sans Arabic** (Arabic + Latin, ADR 031, via `next/font/google`); self-hosted `Cairo-Arabic` is a unicode-range Arabic fallback; Playfair/Bodoni/Fraunces are display faces. JetBrains Mono is copied to `public/fonts/` by `npm run setup-fonts` but is **not wired** (`--font-mono` resolves to Plex). No Inter; `next/font` self-hosts at build, nothing fetched from Google at runtime
✅ **Language toggle** with localStorage persistence (`src/components/LanguageToggle.tsx`)
✅ **Tailwind CSS** configured for logical properties (RTL-aware)
✅ **Translation files** in `/messages/` directory

## Running the Project

```bash
# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev
```

Visit:
- **http://localhost:3000** - Default (Arabic with RTL)
- **http://localhost:3000/en** - English version

## Using Translations

### In Server Components

```tsx
import { useTranslations } from 'next-intl';

export default function MyPage() {
  const t = useTranslations('nav');
  return <h1>{t('dashboard')}</h1>;
}
```

### In Client Components

```tsx
'use client';
import { useTranslations } from 'next-intl';

export default function MyComponent() {
  const t = useTranslations('nav');
  return <button>{t('settings')}</button>;
}
```

## Adding Translations

Edit these files:
- `/messages/ar.json` - Arabic translations
- `/messages/en.json` - English translations

Example:
```json
{
  "nav": {
    "dashboard": "لوحة التحكم"
  },
  "common": {
    "welcome": "مرحبا",
    "hello": "أهلا"
  }
}
```

## RTL-Aware Styling

Always use logical properties for RTL support:

```tsx
// ✅ Good - Works in both LTR and RTL
<div className="ms-4 pe-8">
  <p className="text-start">Content</p>
</div>

// ❌ Bad - Only works in LTR
<div className="ml-4 pr-8">
  <p className="text-left">Content</p>
</div>
```

## Key Files

| File | Purpose |
|------|---------|
| `messages/ar.json` | Arabic translations |
| `messages/en.json` | English translations |
| `src/proxy.ts` | Middleware (locale routing + tenancy/auth) — aliased `proxy.ts`, not `middleware.ts` (verified 2026-07-18) |
| `src/i18n/routing.ts` | Routing configuration (`defaultLocale: 'ar'`, `localePrefix: 'always'`) |
| `src/components/LanguageToggle.tsx` | Language switcher |
| `src/app/globals.css` | `@font-face` font declarations (verified 2026-07-18) |
| `scripts/setup-fonts.mjs` | Copies woff2 fonts from `@fontsource` into `public/fonts/` |

## Features Demo

Check out the homepage to see:
- ✨ RTL/LTR switching
- ✨ Font rendering across Arabic and Latin scripts
- ✨ Logical properties demo
- ✨ Language toggle with persistence
- ✨ All navigation items translated

## Next Steps

1. **Add more translations** to `messages/*.json`
2. **Create new pages** in `src/app/[locale]/`
3. **Use the localized Link** component: `import { Link } from '@/i18n/routing'`
4. **Always use logical properties** for margins, padding, and positioning

For more details, see `README-I18N.md`
