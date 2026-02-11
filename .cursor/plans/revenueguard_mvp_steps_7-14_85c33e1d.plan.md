---
name: RevenueGuard MVP Steps 7-14
overview: Implement complete authentication, student management, QR scanning, offline mode, dashboard, payment tracking, and settings for the RevenueGuard (CenterHQ) educational center management system using Next.js, Supabase, and Arabic-first i18n.
todos:
  - id: supabase-sms-setup
    content: Configure SMS provider in Supabase Dashboard for phone OTP authentication
    status: completed
  - id: step7-login
    content: "Implement phone OTP login page with Egyptian phone format validation, two-step verification, Google/Facebook OAuth buttons, and post-auth onboarding flow (new user: create center or join via invite code)"
    status: completed
  - id: auth-middleware
    content: Create authentication middleware to protect routes and check user sessions
    status: completed
  - id: step8-import
    content: Build student import page with CSV/XLSX parsing, column mapping, and bulk insert
    status: completed
  - id: step9-qr-generation
    content: Auto-generate QR codes after student import and create printable QR cards page
    status: completed
  - id: step10-scanner
    content: Implement QR scanner with camera and Bluetooth modes, full-screen status displays
    status: completed
  - id: step11-offline
    content: Add Service Worker, IndexedDB caching, and offline sync queue with indicator
    status: completed
  - id: step12-dashboard
    content: Build dashboard with Recharts visualizations and Supabase real-time subscriptions
    status: completed
  - id: step13-payments
    content: Create payment management page with filters, bulk actions, and Excel export
    status: completed
  - id: step14-settings
    content: Implement settings page and subscription check middleware with suspended page
    status: completed
  - id: translations
    content: Add all Arabic and English translation keys to messages/ar.json and messages/en.json
    status: completed
  - id: testing
    content: Test complete end-to-end flow from login through scanning to payments
    status: completed
isProject: false
---

# RevenueGuard MVP Implementation Plan (Steps 7-14)

## Current State

Your codebase has excellent foundations:

- Next.js 16.1.6 with App Router configured at `[src/app/[locale]](src/app/[locale])`
- Supabase client configured in `[src/lib/supabase.ts](src/lib/supabase.ts)`
- Complete i18n setup with Arabic (default) and English in `[messages/](messages/)`
- RTL support with logical properties
- All required libraries installed: `html5-qrcode`, `qrcode`, `recharts`, `xlsx`, `@supabase/supabase-js`
- Placeholder pages exist with proper i18n structure

## Prerequisites

### Supabase Phone Auth Setup (Required for Step 7)

Before implementing the login page, configure SMS authentication in your Supabase project:

1. **Navigate to**: Supabase Dashboard → Authentication → Providers → Phone
2. **Enable** Phone authentication
3. **Choose SMS Provider**:
  - **Twilio** (recommended for Egypt): Requires Twilio account, Phone Number SID, Auth Token
  - **MessageBird**: Alternative provider
  - **Vonage**: Another option
  - **Test Mode**: Use built-in test OTP (for development only - no real SMS sent)
4. **For Egyptian phone numbers**: Twilio supports Egypt (+20 country code)
5. **Environment variables needed**: Add to `[.env.local](.env.local)`:
  - If using Supabase built-in: Already configured
  - If using custom Twilio: Configure in Supabase dashboard

### Database Schema Verification

Since you confirmed tables exist, verify these tables are in your Supabase database:

**Required tables**:

- `centers` (id, name, logo_url, subscription_status, subscription_end_date)
- `users` (id, center_id, phone, role, created_at)
- `subjects` (id, center_id, name, monthly_fee)
- `students` (id, center_id, name, phone, parent_phone, subject_id, monthly_fee, payment_status, last_paid_date, qr_code, qr_data)
- `payments` (id, student_id, center_id, amount, payment_method, payment_date, created_by)
- `attendance_scans` (id, student_id, center_id, scanned_at, scanned_by, synced)
- `audit_log` (id, center_id, user_id, action, entity_type, entity_id, details, created_at)
- `subscriptions` (id, center_id, status, plan, start_date, end_date, fawry_reference)

---

## Step 7: Phone OTP Login Page + Social OAuth + Onboarding

**Files to modify**: `[src/app/[locale]/login/page.tsx](src/app/[locale]/login/page.tsx)`

**Files to create**:

- `src/app/[locale]/login/actions.ts` (Server Actions for auth)
- `src/components/PhoneInput.tsx` (Egyptian phone format)
- `src/components/OTPInput.tsx` (6-digit code input)
- `src/components/SocialLoginButtons.tsx` (Google + Facebook OAuth buttons)
- `src/app/[locale]/onboarding/page.tsx` (post-auth: create center or join via invite code)
- `src/app/auth/callback/route.ts` (OAuth callback handler for Supabase redirect)

**Translation keys to add** to `[messages/ar.json](messages/ar.json)` and `messages/en.json`:

```json
{
  "login": {
    "phoneTitle": "تسجيل الدخول برقم الهاتف",
    "phonePlaceholder": "01XXXXXXXXX",
    "phoneLabel": "رقم الهاتف المصري",
    "sendOTP": "إرسال الرمز",
    "otpTitle": "أدخل الرمز",
    "otpPlaceholder": "000000",
    "verify": "تحقق",
    "resend": "إعادة إرسال",
    "invalidPhone": "رقم هاتف غير صحيح",
    "otpSent": "تم إرسال الرمز",
    "otpError": "رمز خاطئ",
    "smsTooMany": "تجاوزت حد الرسائل (4 رسائل/ساعة)",
    "orDivider": "أو",
    "google": "تسجيل الدخول بجوجل",
    "facebook": "تسجيل الدخول بفيسبوك"
  },
  "onboarding": {
    "title": "مرحبا بك في CenterHQ",
    "subtitle": "اختر كيف تريد المتابعة",
    "createCenter": "إنشاء مركز جديد",
    "joinCenter": "الانضمام لمركز موجود",
    "centerName": "اسم المركز",
    "inviteCode": "رمز الدعوة",
    "continue": "متابعة",
    "invalidCode": "رمز دعوة غير صحيح",
    "centerCreated": "تم إنشاء المركز بنجاح"
  }
}
```

**Implementation approach**:

### 7.1: Phone OTP Section (top half of login form)

1. **Replace email/password form** with phone number input
2. **Phone validation**: Format must be `01[0125][0-9]{8}` (Egyptian mobile)
3. **Two-step UI**:
  - Step 1: Phone input -> calls `supabase.auth.signInWithOtp({ phone: '+20...' })`
  - Step 2: OTP input (6 digits) -> calls `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`
4. **Loading states**: Show spinner on "Send Code" and "Verify" buttons
5. **Error handling**: Display Arabic error messages for invalid phone, expired OTP, rate limits

### 7.2: Horizontal Divider

Between the phone OTP section and social buttons, show a divider:

```tsx
<div className="relative my-6">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-gray-300 dark:border-gray-600" />
  </div>
  <div className="relative flex justify-center text-sm">
    <span className="px-4 bg-white dark:bg-gray-800 text-gray-500">
      {t('orDivider')}
    </span>
  </div>
</div>
```

### 7.3: Social Login Buttons (below divider)

Create `src/components/SocialLoginButtons.tsx` as a `'use client'` component:

**Google button**:
- Full width, white (`#ffffff`) background, 1px `#dadce0` border
- Google "G" colored logo (SVG inline) on the start side
- Dark text (`#3c4043`): "تسجيل الدخول بجوجل"
- Hover: light gray bg (`#f8f9fa`)

**Facebook button**:
- Full width, Facebook blue (`#1877F2`) background
- White Facebook "f" logo (SVG inline) on the start side
- White text: "تسجيل الدخول بفيسبوك"
- Hover: darker blue (`#166fe5`)

**Both buttons** call:

```typescript
import { supabase } from '@/lib/supabase';

async function handleSocialLogin(provider: 'google' | 'facebook') {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  });
  if (error) {
    // Show Arabic error message
  }
}
```

### 7.4: OAuth Callback Route

Create `src/app/auth/callback/route.ts` to handle the redirect back from Google/Facebook:

```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = createRouteHandlerClient({ cookies });
    await supabase.auth.exchangeCodeForSession(code);

    // Check if user exists in the users table
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userRecord } = await supabase
      .from('users')
      .select('id, center_id')
      .eq('id', user.id)
      .single();

    if (userRecord?.center_id) {
      // Existing user with center -> go to dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url));
    } else {
      // New user -> go to onboarding
      return NextResponse.redirect(new URL('/onboarding', request.url));
    }
  }

  return NextResponse.redirect(new URL('/login', request.url));
}
```

### 7.5: Post-Auth Onboarding Flow

Create `src/app/[locale]/onboarding/page.tsx` for new users (reached after first-time phone OTP or OAuth):

**Two options presented**:

1. **"Create a new center"** (اسم المركز جديد):
   - Show a text input for center name
   - On submit: create a `centers` record, create a `users` record linked to the new center with role `admin`, create a default `subscriptions` record (e.g. trial period)
   - Redirect to `/dashboard`

2. **"Join an existing center"** (الانضمام لمركز):
   - Show a text input for invite code
   - On submit: look up the invite code in a `center_invites` table (or match a code on the `centers` table)
   - If valid: create a `users` record with the matched `center_id` and role `assistant`
   - Redirect to `/dashboard`

**UI**: Two large cards side by side (or stacked on mobile) with icons, Arabic text, and a form field each. Mobile-first, same card style as login page.

### 7.6: Common Auth Success Logic

Both phone OTP success and OAuth callback follow the same post-auth check:

```
Auth succeeds
  -> Query `users` table for auth user ID
  -> IF user record exists AND has center_id:
       redirect to /dashboard
  -> ELSE:
       redirect to /onboarding
```

### 7.7: Additional Login Page Details

- **Mobile-first responsive**: Full-screen centered card, large touch targets (min 48px button height)
- **RevenueGuard logo**: Add placeholder image/text at top of form
- **Layout order**: Logo -> Phone OTP form -> "أو" divider -> Google button -> Facebook button -> Back to home link

### 7.8: Supabase Dashboard Prerequisites for Social Login

Before implementation will work, these must be configured in Supabase Dashboard:

**Google OAuth**:
1. Navigate to: Supabase Dashboard -> Authentication -> Providers -> Google
2. Enable Google provider
3. Create OAuth credentials in Google Cloud Console (https://console.cloud.google.com/apis/credentials)
4. Set authorized redirect URI to: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
5. Copy Client ID and Client Secret into Supabase

**Facebook OAuth**:
1. Navigate to: Supabase Dashboard -> Authentication -> Providers -> Facebook
2. Enable Facebook provider
3. Create app at https://developers.facebook.com/
4. Set OAuth redirect URI to: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
5. Copy App ID and App Secret into Supabase

**Authentication middleware**: Update `[src/middleware.ts](src/middleware.ts)` to check session and protect routes

---

## Step 8: Student Import Page

**Files to create**:

- `src/app/[locale]/students/import/page.tsx` (main import UI)
- `src/app/[locale]/students/import/actions.ts` (Server Actions for import)
- `src/components/FileUploadZone.tsx` (drag-drop upload)
- `src/components/ColumnMapper.tsx` (map CSV columns)
- `src/lib/excel-parser.ts` (parse CSV/XLSX)

**Translation keys**:

```json
{
  "import": {
    "title": "استيراد الطلاب",
    "upload": "ارفع الملف",
    "acceptedFormats": "CSV أو XLSX",
    "preview": "معاينة",
    "mapColumns": "ربط الأعمدة",
    "studentName": "اسم الطالب",
    "phone": "رقم الطالب",
    "parentPhone": "رقم ولي الأمر",
    "subject": "المادة",
    "monthlyFee": "الاشتراك الشهري",
    "confirm": "تأكيد الاستيراد",
    "success": "تم استيراد {count} طالب",
    "error": "حدث خطأ في الاستيراد",
    "skipRow": "تجاهل السطر"
  }
}
```

**Implementation flow**:

1. **File upload area**: Accept `.csv` and `.xlsx`, drag-drop or click to browse
2. **Parse file**: Use `xlsx` library:
  ```typescript
   import * as XLSX from 'xlsx';
   const workbook = XLSX.read(file, { type: 'buffer' });
   const sheet = workbook.Sheets[workbook.SheetNames[0]];
   const data = XLSX.utils.sheet_to_json(sheet);
  ```
3. **Preview table**: Show first 10 rows with all columns
4. **Column mapping step**:
  - Detect likely matches (name, phone, parent, subject, fee)
  - Allow manual dropdown mapping
  - Mark required fields (name, phone required; others optional)
5. **UTF-8 handling**: Ensure Arabic names display correctly (xlsx library handles this by default)
6. **Validation**:
  - Check phone format
  - Validate monthly_fee is numeric
  - Check if student phone already exists (warn, allow skip/overwrite)
7. **Bulk insert**: Use Supabase batch insert:
  ```typescript
   const { data, error } = await supabase.from('students').insert(students);
  ```
8. **Success screen**: Show count and button to "View Students" or "Generate QR Codes"
9. **Error handling**: Show row-by-row errors, allow retry

**Link from students page**: Add "Import Students" button to `[src/app/[locale]/students/page.tsx](src/app/[locale]/students/page.tsx)`

---

## Step 9: QR Code Generation & Printing

**Files to create**:

- `src/lib/qr-generator.ts` (generate QR from student UUID)
- `src/app/[locale]/students/print/page.tsx` (printable QR cards)
- `src/app/[locale]/students/print/print-styles.css` (print-only CSS)

**Translation keys**:

```json
{
  "students": {
    "generateQR": "توليد الأكواد",
    "printCards": "طباعة البطاقات",
    "qrGenerated": "تم توليد {count} كود QR"
  },
  "print": {
    "title": "طباعة بطاقات الطلاب",
    "printButton": "طباعة",
    "cardsPerPage": "8 بطاقات/صفحة A4"
  }
}
```

**Implementation**:

### 9.1: Auto-generate QR after import

In `students/import/actions.ts`, after successful insert:

```typescript
import QRCode from 'qrcode';

for (const student of insertedStudents) {
  const qrDataURL = await QRCode.toDataURL(student.id, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'H'
  });
  
  await supabase
    .from('students')
    .update({ qr_code: qrDataURL, qr_data: student.id })
    .eq('id', student.id);
}
```

### 9.2: Print page layout

**Route**: `/students/print?subject=all` (query param for filtering)

**Card grid**:

- 8 cards per A4 page (2 columns × 4 rows)
- Each card: ~90mm × 55mm
- CSS Grid with `break-inside: avoid`
- Print media query to hide nav/buttons

**Card content** (Arabic RTL):

```
┌─────────────────────────────┐
│  [RevenueGuard Logo]        │
│                             │
│  أحمد محمد علي              │
│  الرياضيات - الصف الثالث    │
│                             │
│     [QR CODE IMAGE]         │
│                             │
└─────────────────────────────┘
```

**Print CSS** (`@media print`):

```css
@media print {
  body * { visibility: hidden; }
  .printable, .printable * { visibility: visible; }
  .printable { position: absolute; left: 0; top: 0; }
  nav, button { display: none !important; }
  @page { size: A4; margin: 10mm; }
}
```

**Print button**: Calls `window.print()`

---

## Step 10: QR Scanner Page

**Files to create**:

- `src/app/[locale]/scan/page.tsx` (scanner UI)
- `src/components/CameraScanner.tsx` (html5-qrcode wrapper)
- `src/components/BluetoothScanner.tsx` (hidden input for keyboard wedge)
- `src/components/ScanResultScreen.tsx` (full-screen GREEN/RED)
- `src/app/[locale]/scan/actions.ts` (process scan, create payment)

**Translation keys**:

```json
{
  "scan": {
    "title": "مسح رمز الطالب",
    "cameraMode": "الكاميرا",
    "bluetoothMode": "الماسح الضوئي",
    "scanning": "جاري المسح...",
    "studentPaid": "مسدد ✓",
    "studentUnpaid": "غير مسدد",
    "payNow": "دفع الآن",
    "selectMethod": "اختر طريقة الدفع",
    "cash": "كاش",
    "instapay": "إنستاباي",
    "vodafone": "فودافون كاش",
    "orange": "أورانج",
    "fawry": "فوري",
    "bankTransfer": "تحويل بنكي",
    "paymentRecorded": "تم تسجيل الدفع",
    "scanError": "خطأ في المسح"
  }
}
```

**Implementation**:

### 10.1: Scanner modes

**Camera Mode**:

```typescript
import { Html5Qrcode } from 'html5-qrcode';

const html5QrCode = new Html5Qrcode('reader');
html5QrCode.start(
  { facingMode: 'environment' }, // Back camera
  { fps: 10, qrbox: { width: 250, height: 250 } },
  onScanSuccess
);
```

**Bluetooth Mode** (keyboard wedge scanners):

```typescript
<input
  type="text"
  autoFocus
  className="opacity-0 absolute"
  onKeyDown={(e) => {
    if (e.key === 'Enter') {
      processQRCode(e.currentTarget.value);
      e.currentTarget.value = ''; // Clear for next scan
    }
  }}
/>
```

### 10.2: Scan processing flow

1. **Decode QR** → Extract student UUID
2. **Lookup student**:
  ```typescript
   const { data: student } = await supabase
     .from('students')
     .select('*, subjects(*)')
     .eq('id', studentId)
     .single();
  ```
3. **Check payment_status**:
  **IF `paid**`:
  - Show **FULL SCREEN GREEN** (`bg-green-500 h-screen w-screen`)
  - Display student name in **LARGE WHITE TEXT** (`text-8xl text-white font-bold`)
  - Auto-dismiss after **3 seconds**
  - Create `attendance_scans` record
   **IF `unpaid**`:
  - Show **FULL SCREEN RED** (`bg-red-500 h-screen w-screen`)
  - Display student name + **"دفع الآن" button**
  - On tap → Show payment method dropdown (6 options)
  - On selection → Server Action:
    - Update `payment_status = 'paid'`, `last_paid_date = NOW()`
    - Insert `payments` record (amount, method, date)
    - Insert `attendance_scans` record
    - Insert `audit_log` record
  - Show GREEN screen → Auto-dismiss

### 10.3: Visual requirements

- **High contrast**: Green (#10b981) and Red (#ef4444) at 100% brightness
- **Dark room visibility**: Text shadows, bold fonts
- **Large text**: `text-6xl` or `text-8xl` for student names
- **No navigation**: Full-screen modal overlays main UI
- **Audio feedback**: Optional beep on successful scan (Web Audio API)

---

## Step 11: Offline Mode (PWA + IndexedDB)

**Files to create**:

- `public/sw.js` (Service Worker for caching)
- `public/manifest.json` (PWA manifest)
- `src/lib/db.ts` (IndexedDB wrapper using `idb` library)
- `src/lib/sync.ts` (offline sync queue)
- `src/components/SyncIndicator.tsx` (online/offline/syncing dot)

**Dependencies to add**:

```bash
npm install idb
npm install --save-dev @types/serviceworker
```

**Translation keys**:

```json
{
  "sync": {
    "online": "متصل",
    "offline": "غير متصل",
    "syncing": "جاري المزامنة...",
    "syncComplete": "تمت المزامنة",
    "syncError": "خطأ في المزامنة"
  }
}
```

**Implementation**:

### 11.1: Service Worker setup

`**public/sw.js**`:

```javascript
const CACHE_NAME = 'revenueguard-v1';
const urlsToCache = ['/', '/scan', '/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
```

**Register in `[src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx)**`:

```typescript
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
}, []);
```

### 11.2: IndexedDB schema

`**src/lib/db.ts**`:

```typescript
import { openDB } from 'idb';

export const db = await openDB('revenueguard', 1, {
  upgrade(db) {
    db.createObjectStore('students', { keyPath: 'id' });
    db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
  },
});

export async function syncStudentsToLocal(centerId: string) {
  const { data } = await supabase
    .from('students')
    .select('*')
    .eq('center_id', centerId);
  
  const tx = db.transaction('students', 'readwrite');
  await Promise.all(data.map(s => tx.store.put(s)));
}

export async function getStudentOffline(id: string) {
  return await db.get('students', id);
}

export async function queueScan(scanData: any) {
  await db.add('syncQueue', { ...scanData, synced: false, timestamp: Date.now() });
}
```

### 11.3: Sync on login

In login success handler:

```typescript
await syncStudentsToLocal(user.center_id);
```

### 11.4: Scanner offline mode

In `scan/page.tsx`, check navigator.onLine:

```typescript
const student = navigator.onLine 
  ? await fetchFromSupabase(qrCode)
  : await getStudentOffline(qrCode);

if (!navigator.onLine) {
  await queueScan({ student_id, scanned_at: new Date(), ... });
}
```

### 11.5: Background sync

```typescript
window.addEventListener('online', async () => {
  const queue = await db.getAll('syncQueue');
  for (const item of queue.filter(i => !i.synced)) {
    await supabase.from('attendance_scans').insert(item);
    await db.put('syncQueue', { ...item, synced: true });
  }
});
```

### 11.6: Sync indicator component

**Corner indicator** (top-right):

- 🟢 Green dot: `navigator.onLine === true`
- 🔴 Red dot: `navigator.onLine === false`
- 🔵 Spinning: Syncing in progress

---

## Step 12: Dashboard with Real-Time Data

**Files to modify**: `[src/app/[locale]/dashboard/page.tsx](src/app/[locale]/dashboard/page.tsx)`

**Files to create**:

- `src/components/dashboard/AttendanceCard.tsx`
- `src/components/dashboard/PaymentDonut.tsx` (Recharts)
- `src/components/dashboard/RevenueBar.tsx` (Recharts)
- `src/components/dashboard/AttendanceTrend.tsx` (Recharts line)
- `src/components/dashboard/UnpaidList.tsx`

**Translation keys**:

```json
{
  "dashboard": {
    "attendance": "الحضور اليوم",
    "paid": "مسدد",
    "unpaid": "غير مسدد",
    "revenue": "الإيرادات اليوم",
    "trend": "اتجاه الحضور (7 أيام)",
    "unpaidStudents": "الطلاب غير المسددين",
    "sendReminder": "إرسال تذكير",
    "totalStudents": "إجمالي الطلاب",
    "collectedToday": "تم تحصيله اليوم",
    "pendingAmount": "المبلغ المستحق"
  }
}
```

**Implementation**:

### 12.1: Today's attendance (big number card)

```typescript
const { count } = await supabase
  .from('attendance_scans')
  .select('*', { count: 'exact', head: true })
  .eq('center_id', centerId)
  .gte('scanned_at', startOfToday());
```

Display as large card: **"47 طالب حضر اليوم"**

### 12.2: Paid vs Unpaid donut chart (Recharts)

```typescript
const { data } = await supabase
  .from('students')
  .select('payment_status')
  .eq('center_id', centerId);

const chartData = [
  { name: 'مسدد', value: data.filter(s => s.payment_status === 'paid').length },
  { name: 'غير مسدد', value: data.filter(s => s.payment_status === 'unpaid').length }
];
```

**Recharts PieChart** with RTL labels

### 12.3: Revenue by payment method (bar chart)

```typescript
const { data } = await supabase
  .from('payments')
  .select('payment_method, amount')
  .eq('center_id', centerId)
  .gte('payment_date', startOfToday());

const chartData = groupBy(data, 'payment_method').map(group => ({
  method: translateMethod(group.payment_method),
  amount: sum(group.items, 'amount')
}));
```

**Recharts BarChart** with Arabic labels (كاش, فودافون, إنستاباي, etc.)

### 12.4: 7-day attendance trend (line chart)

```typescript
const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), i));
const chartData = await Promise.all(
  last7Days.map(async (day) => ({
    date: format(day, 'dd/MM'),
    count: await getAttendanceCount(day)
  }))
);
```

**Recharts LineChart** with smooth curve

### 12.5: Unpaid students list

```typescript
const { data: unpaidStudents } = await supabase
  .from('students')
  .select('*, subjects(*)')
  .eq('center_id', centerId)
  .eq('payment_status', 'unpaid')
  .order('name');
```

Display as table with:

- Student name
- Subject
- Monthly fee
- "Send Reminder" button (WhatsApp - placeholder for now, real implementation in Step 16)

### 12.6: Real-time subscriptions

```typescript
useEffect(() => {
  const channel = supabase
    .channel('dashboard-updates')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'attendance_scans' },
      () => refreshDashboard()
    )
    .subscribe();
  
  return () => supabase.removeChannel(channel);
}, []);
```

Dashboard auto-updates when scans happen

---

## Step 13: Payment Management Page

**Files to modify**: `[src/app/[locale]/payments/page.tsx](src/app/[locale]/payments/page.tsx)`

**Files to create**:

- `src/components/payments/PaymentFilters.tsx`
- `src/components/payments/BulkActions.tsx`
- `src/lib/excel-export.ts`

**Translation keys**:

```json
{
  "payments": {
    "title": "إدارة المدفوعات",
    "filterPaid": "مسدد",
    "filterUnpaid": "غير مسدد",
    "filterAll": "الكل",
    "filterBySubject": "حسب المادة",
    "filterByDate": "حسب التاريخ",
    "selectAll": "تحديد الكل",
    "selectAllUnpaid": "تحديد كل غير المسددين",
    "bulkMarkPaid": "تعيين كمسدد",
    "bulkSendReminder": "إرسال تذكير",
    "export": "تصدير Excel",
    "lastPaidDate": "آخر دفعة",
    "paymentMethod": "طريقة الدفع",
    "confirmed": "تم تعيين {count} طالب كمسدد"
  }
}
```

**Implementation**:

### 13.1: Main table

Columns (RTL):

- ☑️ Checkbox (bulk selection)
- اسم الطالب (Name)
- المادة (Subject)
- الحالة (Status badge: green for paid, red for unpaid)
- آخر دفعة (Last paid date)
- طريقة الدفع (Payment method)
- الإجراءات (Actions: mark paid, send reminder)

### 13.2: Filters

**Status toggle**:

- All / Paid / Unpaid (tabs or segmented control)

**Subject dropdown**:

```typescript
const { data: subjects } = await supabase.from('subjects').select('*');
```

**Date range picker**:

- From date / To date inputs
- Filter `last_paid_date` between range

### 13.3: Bulk selection

**"Select All Unpaid" button**:

```typescript
const unpaidIds = students
  .filter(s => s.payment_status === 'unpaid')
  .map(s => s.id);
setSelected(unpaidIds);
```

**Checkbox logic**: Track selected IDs in state

### 13.4: Bulk actions

**"Mark as Paid" button** (enabled when selections exist):

1. Show payment method dropdown modal
2. On confirm → Server Action:

```typescript
await supabase
  .from('students')
  .update({ payment_status: 'paid', last_paid_date: new Date() })
  .in('id', selectedIds);

await supabase.from('payments').insert(
  selectedIds.map(id => ({
    student_id: id,
    amount: students.find(s => s.id === id).monthly_fee,
    payment_method: selectedMethod,
    payment_date: new Date()
  }))
);

await supabase.from('audit_log').insert({
  action: 'bulk_payment_update',
  entity_type: 'students',
  details: { ids: selectedIds, method: selectedMethod }
});
```

**"Send Reminder" button**:

- Placeholder for now (logs to audit_log)
- Real WhatsApp implementation in Week 6 (not in this plan)

### 13.5: Excel export

```typescript
import * as XLSX from 'xlsx';

function exportToExcel(students: Student[]) {
  const worksheet = XLSX.utils.json_to_sheet(
    students.map(s => ({
      'اسم الطالب': s.name,
      'المادة': s.subjects.name,
      'الحالة': s.payment_status === 'paid' ? 'مسدد' : 'غير مسدد',
      'آخر دفعة': s.last_paid_date,
      'طريقة الدفع': s.payment_method
    }))
  );
  
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'المدفوعات');
  XLSX.writeFile(workbook, `payments-${Date.now()}.xlsx`);
}
```

**Export button**: Downloads filtered/selected students as `.xlsx`

---

## Step 14: Settings & Subscription Management

**Files to modify**: `[src/app/[locale]/settings/page.tsx](src/app/[locale]/settings/page.tsx)`

**Files to create**:

- `src/app/[locale]/suspended/page.tsx` (subscription suspended screen)
- `src/components/settings/CenterInfo.tsx`
- `src/components/settings/SubjectsManager.tsx`
- `src/components/settings/AssistantsManager.tsx`
- `src/components/settings/ScannerConfig.tsx`
- `src/middleware/subscription-check.ts`

**Translation keys**:

```json
{
  "settings": {
    "title": "الإعدادات",
    "centerInfo": "معلومات المركز",
    "centerName": "اسم المركز",
    "logoUpload": "رفع الشعار",
    "subjects": "إدارة المواد",
    "addSubject": "إضافة مادة",
    "subjectName": "اسم المادة",
    "monthlyFee": "الاشتراك الشهري",
    "assistants": "المساعدين",
    "inviteByPhone": "دعوة برقم الهاتف",
    "role": "الدور",
    "admin": "مشرف",
    "assistant": "مساعد",
    "scanner": "إعدادات الماسح",
    "defaultMode": "الوضع الافتراضي",
    "camera": "الكاميرا",
    "bluetooth": "الماسح الضوئي"
  },
  "suspended": {
    "title": "انتهى اشتراكك",
    "message": "يرجى التجديد للاستمرار في استخدام النظام",
    "fawryCode": "كود فوري: {code}",
    "whatsapp": "للدعم: اتصل واتساب",
    "renewButton": "تجديد الآن"
  }
}
```

**Implementation**:

### 14.1: Center info section

**Center name** (editable):

```typescript
<input
  value={centerName}
  onChange={(e) => setCenterName(e.target.value)}
  onBlur={async () => {
    await supabase.from('centers').update({ name: centerName }).eq('id', centerId);
  }}
/>
```

**Logo upload** (Supabase Storage):

```typescript
async function uploadLogo(file: File) {
  const { data, error } = await supabase.storage
    .from('center-logos')
    .upload(`${centerId}/${file.name}`, file);
  
  const publicURL = supabase.storage.from('center-logos').getPublicUrl(data.path).data.publicUrl;
  
  await supabase.from('centers').update({ logo_url: publicURL }).eq('id', centerId);
}
```

### 14.2: Subjects management

**List subjects**:

```typescript
const { data: subjects } = await supabase
  .from('subjects')
  .select('*')
  .eq('center_id', centerId);
```

**Add subject form**:

- Name input (Arabic)
- Monthly fee input (number)
- Save button → insert into `subjects` table

**Edit/Delete actions**:

- Inline edit → update
- Delete button → check if any students use this subject (prevent deletion if in use)

### 14.3: Assistants management

**Invite by phone**:

1. Phone input (Egyptian format)
2. Role dropdown: Admin / Assistant
3. Send button → create record in `users` table:

```typescript
await supabase.from('users').insert({
  phone: invitePhone,
  center_id: centerId,
  role: selectedRole
});
```

**List assistants**:

- Show phone, role
- Edit role or remove access

### 14.4: Scanner configuration

**Default mode selection**:

- Radio buttons: Camera / Bluetooth
- Save to user preferences or `centers` table:

```typescript
await supabase.from('centers').update({ scanner_default_mode: mode }).eq('id', centerId);
```

Load this setting in `/scan` page to pre-select mode

### 14.5: Subscription check middleware

**Create middleware** to check subscription status on every navigation:

`**src/middleware/subscription-check.ts**`:

```typescript
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';

export async function subscriptionMiddleware(request: NextRequest) {
  const supabase = createMiddlewareClient({ req: request, res: response });
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return NextResponse.next();
  
  const { data: userRecord } = await supabase
    .from('users')
    .select('center_id')
    .eq('id', user.id)
    .single();
  
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, end_date, fawry_reference')
    .eq('center_id', userRecord.center_id)
    .single();
  
  if (subscription.status === 'suspended' && !request.nextUrl.pathname.startsWith('/suspended')) {
    return NextResponse.redirect(new URL('/suspended', request.url));
  }
  
  return NextResponse.next();
}
```

**Integrate** into `[src/middleware.ts](src/middleware.ts)` (chain with next-intl middleware)

### 14.6: Suspended page

**Route**: `/suspended`

**UI**:

- Full-screen centered card
- Arabic message: "انتهى اشتراكك. يرجى التجديد للاستمرار."
- Display Fawry reference code from `subscriptions.fawry_reference`
- WhatsApp contact button (opens `https://wa.me/201234567890`)
- "Renew Now" button (link to Fawry payment or contact sales)
- **No navigation** or access to other pages until renewed

---

## Testing Strategy

### End-to-End Test Flow

1. **Login (Phone OTP)**: Enter Egyptian phone -> receive SMS -> enter OTP -> if new user, land on `/onboarding` -> create center -> land on `/dashboard`
1b. **Login (Google OAuth)**: Click "تسجيل الدخول بجوجل" -> authenticate with Google -> redirect back -> if new user, land on `/onboarding`; if existing, land on `/dashboard`
1c. **Login (Facebook OAuth)**: Click "تسجيل الدخول بفيسبوك" -> authenticate with Facebook -> redirect back -> same onboarding flow as Google
2. **Import students**: Upload CSV with 50 students → map columns → confirm → see success
3. **Generate QR**: Auto-generated after import → navigate to `/students/print` → verify all 50 QR codes display
4. **Print**: Click print button → verify 7 pages (8 cards per page for 50 students)
5. **Scan (online)**:
  - Camera mode: Scan a paid student → see GREEN screen
  - Camera mode: Scan unpaid student → see RED screen → tap "Pay Now" → select "Cash" → see GREEN
  - Bluetooth mode: Use barcode scanner → same flow
6. **Offline test**:
  - Enable airplane mode
  - Scan 5 students with camera
  - Verify scans stored in IndexedDB
  - Disable airplane mode
  - Verify sync indicator shows "syncing"
  - Check Supabase: all 5 scans appear in `attendance_scans`
7. **Dashboard**: Verify today's count updates in real-time after scan
8. **Payments**: Filter unpaid → select all → mark as paid (Instapay) → export Excel
9. **Settings**: Change center name, upload logo, add subject, invite assistant
10. **Suspension**: Manually set subscription status to 'suspended' in Supabase → verify redirect to `/suspended`

---

## Environment Variables Checklist

Verify these in `[.env.local](.env.local)`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

---

## Additional Dependencies

These may be needed (check during implementation):

```bash
npm install idb                    # IndexedDB wrapper (Step 11)
npm install date-fns               # Date utilities (optional)
npm install @types/qrcode --save-dev
```

---

## Summary of New Routes


| Route              | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `/login`           | Phone OTP + Google/Facebook OAuth (replace existing)     |
| `/onboarding`      | New user: create center or join via invite code           |
| `/auth/callback`   | OAuth redirect handler (exchanges code for session)      |
| `/dashboard`       | Real-time metrics (enhance existing)        |
| `/students/import` | CSV/XLSX import                             |
| `/students/print`  | Printable QR cards                          |
| `/scan`            | QR scanner (replace `/scanner`)             |
| `/payments`        | Payment management (enhance existing)       |
| `/settings`        | Center configuration (enhance existing)     |
| `/suspended`       | Subscription suspended screen               |


---

## Files That Need Significant Changes

**Completely replace**:

- `[src/app/[locale]/login/page.tsx](src/app/[locale]/login/page.tsx)` - Phone OTP + Google/Facebook OAuth instead of email/password
- `[src/app/[locale]/dashboard/page.tsx](src/app/[locale]/dashboard/page.tsx)` - Add charts and real-time data

**Enhance/extend**:

- `[src/app/[locale]/students/page.tsx](src/app/[locale]/students/page.tsx)` - Add "Import" and "Print" buttons
- `[src/app/[locale]/scanner/page.tsx](src/app/[locale]/scanner/page.tsx)` - Rename to `/scan`, implement camera + Bluetooth
- `[src/app/[locale]/payments/page.tsx](src/app/[locale]/payments/page.tsx)` - Build full payment table with filters
- `[src/app/[locale]/settings/page.tsx](src/app/[locale]/settings/page.tsx)` - Add all settings sections

**Update**:

- `[src/middleware.ts](src/middleware.ts)` - Add auth protection and subscription checks
- `[messages/ar.json](messages/ar.json)` and `messages/en.json` - Add ~100 translation keys

---

## Post-MVP (Week 5+, Not in This Plan)

These are mentioned in your full project but NOT part of Steps 7-14:

- ❌ WhatsApp integration (Week 5-6)
- ❌ Staff POS & sales tracking (Module 3)
- ❌ Expenses & budgeting (Module 4)
- ❌ AI late student predictor (Module 5)
- ❌ Call center & data entry (Module 6)
- ❌ Deployment to Vercel (after MVP complete)

---

## Estimated Complexity


| Step          | Complexity | Key Challenges                                               |
| ------------- | ---------- | ------------------------------------------------------------ |
| 7: Login      | Medium-High | Supabase phone auth + Google/Facebook OAuth + onboarding flow |
| 8: Import     | Medium     | CSV parsing, column mapping, UTF-8 handling                  |
| 9: QR Gen     | Low        | QR library straightforward, print CSS needs testing          |
| 10: Scanner   | High       | Camera permissions, Bluetooth input handling, full-screen UX |
| 11: Offline   | High       | Service Worker, IndexedDB, sync logic                        |
| 12: Dashboard | Medium     | Recharts integration, real-time subscriptions                |
| 13: Payments  | Medium     | Bulk operations, Excel export                                |
| 14: Settings  | Medium     | File upload to Supabase Storage, middleware chaining         |


---

## Success Criteria

✅ Login with Egyptian phone number works end-to-end
✅ Login with Google OAuth works end-to-end (redirect + callback + onboarding)
✅ Login with Facebook OAuth works end-to-end (redirect + callback + onboarding)
✅ New users land on onboarding page and can create a center or join via invite code
✅ Import CSV with Arabic names, generate QR codes, print cards
✅ Scanner works in camera and Bluetooth modes
✅ Offline scanning queues and syncs when back online
✅ Dashboard updates in real-time when scans happen
✅ Bulk payment updates work and log to audit
✅ Settings saved and subscription check blocks access when suspended

**Result**: Complete MVP with Modules 1, 2, and 7 functional as specified in your roadmap.