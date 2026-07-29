import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { fetchAdminPermissionKeys } from '@/lib/adminPermissionsStore';

/**
 * Lightweight admin gate for client-side routing (cookie or Bearer session).
 * Mirrors `getAdminContext` - includes cookie auth so SPA checks work without Bearer headers.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) {
      return NextResponse.json({ isAdmin: false });
    }

    const { data: adminUser } = await ctx.supabaseAdmin
      .from('admin_users')
      .select('role')
      .eq('id', ctx.userId)
      .maybeSingle();

    // Canonical store since 2026-07-30. The response field keeps its wire name
    // so existing clients are unaffected; only where the value comes from moved.
    const customPermissions = await fetchAdminPermissionKeys(ctx.supabaseAdmin, ctx.userId);
    const role =
      ctx.internalRole === 'super_admin'
        ? 'super_admin'
        : adminUser?.role === 'admin' || adminUser?.role === 'internal_admin'
          ? 'admin'
          : adminUser?.role ?? ctx.internalRole;

    const canApproveSignups =
      ctx.internalRole === 'super_admin' || customPermissions.includes('can_approve_signups');

    return NextResponse.json({
      isAdmin: true,
      role,
      customPermissions,
      canApproveSignups,
      hasCenter: false,
    });
  } catch (err) {
    console.error('[admin/check]', err);
    return NextResponse.json({ isAdmin: false });
  }
}
