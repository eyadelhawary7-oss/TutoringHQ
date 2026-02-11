# CenterHQ Pages Structure

## Public Pages (No Locale/Translation)

These pages are outside the i18n routing and use hardcoded Arabic:

### 🏠 Landing Page
- **Path**: `/` (root)
- **File**: `src/app/page.tsx`
- **Features**:
  - Clean, professional design
  - Blue/indigo color scheme
  - RTL layout (`dir="rtl"`)
  - Shows: CenterHQ branding, Arabic subtitle, features grid
  - CTA button links to `/login`

### 🔐 Login Page
- **Path**: `/login`
- **File**: `src/app/login/page.tsx`
- **Features**:
  - Mobile-first login form
  - Email & password fields
  - "Remember me" checkbox
  - "Forgot password" link
  - Sign up link
  - Back to home link

## Internationalized App Pages (Arabic/English)

These pages use next-intl for translations:

### App Entry Points
- `/ar` or just `/dashboard` → Arabic dashboard (default)
- `/en` → English home page
- `/en/dashboard` → English dashboard

### All App Routes (Available in AR/EN)
- `/[locale]/dashboard` - Dashboard
- `/[locale]/students` - Students management
- `/[locale]/scanner` - QR scanner
- `/[locale]/payments` - Payments
- `/[locale]/schedule` - Schedule
- `/[locale]/messages` - Messages
- `/[locale]/settings` - Settings
- `/[locale]/demo` - Full i18n demo page

## Middleware Configuration

The middleware (`src/middleware.ts`) handles routing:

1. **Skips** i18n for:
   - `/` (landing page)
   - `/login` (login page)

2. **Applies** i18n routing to:
   - All other paths (adds `/ar` or `/en` prefix)

## User Journey Flow

```
1. User visits centerhq.com (/)
   ↓
2. Sees Arabic landing page
   ↓
3. Clicks "تسجيل الدخول" button
   ↓
4. Goes to /login
   ↓
5. After login, redirected to /ar/dashboard (or /en/dashboard)
   ↓
6. Now in the internationalized app with navbar & language toggle
```

## Testing URLs (Development)

- `http://localhost:3000` → Landing page (Arabic)
- `http://localhost:3000/login` → Login page
- `http://localhost:3000/ar` → Arabic app home
- `http://localhost:3000/en` → English app home
- `http://localhost:3000/ar/dashboard` → Arabic dashboard
- `http://localhost:3000/en/dashboard` → English dashboard

## Styling

All pages use:
- ✅ Tailwind CSS
- ✅ Mobile-first responsive design
- ✅ Dark mode support
- ✅ Blue/indigo color scheme
- ✅ Clean, professional look
- ✅ RTL support where needed
