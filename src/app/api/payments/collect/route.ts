import { NextRequest, NextResponse } from 'next/server';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';

// Allowed collection methods (mirrors the client method picker). Anything else
// is rejected server-side rather than trusted from the request body.
const ALLOWED_METHODS = new Set([
  'cash',
  'instapay',
  'vodafone_cash',
  'orange_cash',
  'fawry',
  'bank_transfer',
]);

/**
 * Record (collect) a student payment.
 *
 * Defense-in-depth server gate for the payment-collection action: previously the
 * page wrote straight to the `payments` table via the /api/db proxy, which only
 * scopes by center_id and performs NO role/permission check — so any user tied to
 * a center (e.g. a zero-permission assistant who bypassed the hidden button) could
 * record arbitrary payments. This route enforces, on the SERVER, the same
 * permission the UI claims to require before any write happens; the caller is
 * denied (and the denial logged) otherwise. Mirrors /api/payments/confirm.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    // Server-side permission gate. Collecting a payment requires the same
    // authority the client uses to show the button: an owner / super-admin, or a
    // staff member explicitly granted can_record_payments (can_view_payments is
    // the broader payments role and also covers collection, matching the page's
    // canCollectPayment derivation).
    const canCollect =
      auth.role === 'owner' ||
      auth.isSuperAdmin === true ||
      auth.permissions.can_view_payments === true ||
      auth.permissions.can_record_payments === true;
    if (!canCollect) {
      // Log the denial (best-effort, append-only audit) so an attempt to bypass
      // the hidden button leaves a trace.
      console.warn(
        '[payments/collect] denied: caller lacks payment-collection permission',
        { userId: auth.userId, centerId: auth.centerId, role: auth.role },
      );
      try {
        await auth.supabaseAdmin.from('audit_log').insert({
          action: 'payment_collect_denied',
          entity_type: 'payments',
          entity_id: null,
          user_id: auth.userId,
          center_id: auth.centerId,
          details: { reason: 'insufficient_permissions', role: auth.role },
        });
      } catch {
        /* audit is best-effort; never block the 403 on a log failure */
      }
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;

    const studentId = typeof body.student_id === 'string' ? body.student_id.trim() : '';
    if (!studentId) {
      return NextResponse.json({ error: 'student_id is required' }, { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    const method = typeof body.method === 'string' ? body.method : '';
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json({ error: 'invalid payment method' }, { status: 400 });
    }

    const groupId = typeof body.group_id === 'string' && body.group_id ? body.group_id : null;

    // The student must belong to the caller's center — never trust a student_id
    // pointed at another tenant.
    const { data: student, error: studentErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, center_id')
      .eq('id', studentId)
      .maybeSingle();

    if (studentErr) {
      console.error('[payments/collect] student lookup error:', studentErr);
      return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
    }
    if (!student || (student as { center_id?: string }).center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Student does not belong to your center' }, { status: 403 });
    }

    const isCash = method === 'cash';
    const paidAt = new Date().toISOString();

    const { data: inserted, error: payErr } = await auth.supabaseAdmin
      .from('payments')
      .insert({
        student_id: studentId,
        // center_id is FORCED to the authenticated caller's center — never read
        // from the request body.
        center_id: auth.centerId,
        amount,
        method,
        recorded_by: auth.userId,
        paid_at: paidAt,
        status: isCash ? 'confirmed' : 'pending',
        confirmed: isCash,
        ...(isCash ? { confirmed_at: paidAt, confirmed_by: auth.userId } : {}),
        group_id: groupId,
      })
      .select('id')
      .single();

    if (payErr || !inserted) {
      console.error('[payments/collect] insert error:', payErr);
      return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 });
    }

    // Append-only audit of the successful collection.
    try {
      await auth.supabaseAdmin.from('audit_log').insert({
        action: 'payment_collect',
        entity_type: 'payments',
        entity_id: (inserted as { id: string }).id,
        user_id: auth.userId,
        center_id: auth.centerId,
        details: { student_id: studentId, amount, method, status: isCash ? 'confirmed' : 'pending' },
      });
    } catch {
      /* audit best-effort */
    }

    return NextResponse.json({
      success: true,
      paymentId: (inserted as { id: string }).id,
      paidAt,
      status: isCash ? 'confirmed' : 'pending',
    });
  } catch (error) {
    console.error('[payments/collect] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
