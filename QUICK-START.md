# Quick Start Guide - Internationalization

Your Next.js project is now fully configured with internationalization! 🎉

## What's Been Set Up

✅ **next-intl** library integration
✅ **Arabic (ar)** as default language with RTL support
✅ **English (en)** as secondary language
✅ **Google Fonts**: Cairo for Arabic, Inter for English
✅ **Language toggle** in navbar with localStorage persistence
✅ **Tailwind CSS** configured for logical properties (RTL-aware)
✅ **Translation files** in `/messages/` directory
✅ **Example pages** demonstrating the i18n system

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
| `src/middleware.ts` | Locale detection |
| `src/i18n/routing.ts` | Routing configuration |
| `src/components/LanguageToggle.tsx` | Language switcher |
| `src/components/Navbar.tsx` | Navigation with translations |
| `src/lib/fonts.ts` | Font configurations |

## Features Demo

Check out the homepage to see:
- ✨ RTL/LTR switching
- ✨ Font changes (Cairo ↔ Inter)
- ✨ Logical properties demo
- ✨ Language toggle with persistence
- ✨ All navigation items translated

## Next Steps

1. **Add more translations** to `messages/*.json`
2. **Create new pages** in `src/app/[locale]/`
3. **Use the localized Link** component: `import { Link } from '@/i18n/routing'`
4. **Always use logical properties** for margins, padding, and positioning

For more details, see `README-I18N.md`
