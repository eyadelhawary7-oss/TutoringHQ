import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateCSRFRequest } from '@/lib/csrf';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Sanitize filename to prevent path traversal and invalid chars */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (!validateCSRFRequest(request, user.id)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const centerId = formData.get('centerId');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!centerId || typeof centerId !== 'string' || centerId.length < 10) {
      return NextResponse.json({ error: 'Invalid center ID' }, { status: 400 });
    }

    // Server-side validation: file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Server-side validation: file type (check both MIME and extension)
    const mime = file.type?.toLowerCase() || '';
    const ext = file.name?.toLowerCase().split('.').pop() || '';
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

    if (!ALLOWED_TYPES.includes(mime) || !allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG, PNG, WebP, and PDF allowed.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Payment-proof upload is a centre-owner billing action (mirrors the
    // owner-only gate on /api/settings/billing). Teachers (Model B, centre-less)
    // and assistants have no proof-upload flow and are denied by role here, not
    // incidentally by the centre match. The teacher subscription is billed via
    // Paymob recurring on the web, never an InstaPay proof upload.
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('center_id, role')
      .eq('id', user.id)
      .single();

    const role = (userRecord as { role?: string | null } | null)?.role ?? null;
    const userCenterId =
      (userRecord as { center_id?: string | null } | null)?.center_id ?? null;

    if (role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!userCenterId || userCenterId !== centerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const safeName = sanitizeFileName(file.name);
    const fileName = `${centerId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('payment-proofs')
      .upload(fileName, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[upload/payment-proof]', uploadError);
      return NextResponse.json(
        { error: uploadError.message || 'Upload failed' },
        { status: 500 }
      );
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('payment-proofs')
      .getPublicUrl(fileName);

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error('[upload/payment-proof]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
