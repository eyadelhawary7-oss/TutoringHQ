# Internationalization Setup Guide

This Next.js App Router project is configured with full internationalization support using `next-intl`.

## Features

✅ **Arabic (ar) as default language** with RTL support
✅ **English (en) as secondary language**
✅ **Google Fonts**: Cairo for Arabic, Inter for English
✅ **Language toggle** with localStorage persistence
✅ **Tailwind CSS logical properties** for RTL-aware layouts
✅ **Automatic locale detection** and routing

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
│   │   └── globals.css
│   ├── components/
│   │   ├── LanguageToggle.tsx  # Language switcher
│   │   └── Navbar.tsx          # Navigation with translations
│   ├── i18n/
│   │   ├── request.ts   # next-intl configuration
│   │   └── routing.ts   # Routing configuration
│   ├── lib/
│   │   └── fonts.ts     # Font configurations
│   └── middleware.ts    # Locale detection middleware
```

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

The `LanguageToggle` component:
- Saves the selected language to localStorage
- Persists across page reloads
- Located in the Navbar

### Font Configuration

- **Arabic**: Uses Cairo font (loaded from Google Fonts)
- **English**: Uses Inter font (loaded from Google Fonts)
- Fonts are automatically applied based on the active locale

## How It Works

1. **Middleware** (`src/middleware.ts`) detects the locale from the URL
2. **Root Layout** (`src/app/layout.tsx`) sets `dir="rtl"` for Arabic and applies the correct font
3. **Routing** is handled by `next-intl` with locale prefixes (e.g., `/ar/dashboard`, `/en/dashboard`)
4. **Default locale** (Arabic) doesn't show prefix in URL by default (configured as `localePrefix: 'as-needed'`)

## URLs

- `/` → Redirects to `/ar` (default locale)
- `/ar` → Arabic version (no prefix shown due to `as-needed` config)
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
3. Add font configuration in `src/lib/fonts.ts` if needed
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
