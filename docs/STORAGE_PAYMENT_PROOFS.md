# Payment Proofs Storage Configuration

Secure the `payment-proofs` Supabase Storage bucket with the following settings to defend against malicious uploads.

## Dashboard Configuration

In **Supabase Dashboard** → **Storage** → **payment-proofs** bucket → **Settings**:

### 0. Visibility (security)
- The bucket is **private** (`public = false`). Payment proofs are financial documents and
  must never be fetchable or enumerable by an unauthenticated URL.
- Reads go through **service-role signed URLs** (`createSignedUrl`), e.g. the upload route
  (`/api/upload/payment-proof`) returns a 7-day signed link. Do **not** re-enable public access
  or add a broad `SELECT` policy for `anon`/`public` on `storage.objects` for this bucket.

### 1. File Size Limit
- **Max file size:** `5 MB` (5,242,880 bytes)
- Prevents large file uploads that could exhaust storage or cause DoS.

### 2. Allowed MIME Types
- `image/jpeg`
- `image/png`
- `image/webp`
- `application/pdf`
- Or use wildcard: `image/*` and `application/pdf`

### 3. Virus Scanning
- If available on your Supabase plan, enable virus scanning for the bucket.
- Check **Supabase Dashboard** → **Settings** → **Storage** for available options.

## Current Application Validation

The app enforces these rules in two places:

1. **Client-side** (`src/app/[locale]/settings/billing/page.tsx`): 5MB max, JPG/PNG/WebP/PDF only.
2. **Server-side** (`/api/upload/payment-proof`): Same checks before uploading to Supabase Storage.

Bucket-level limits provide an extra safeguard if the API is bypassed.
