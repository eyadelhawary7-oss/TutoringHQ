import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { customPermissionsToKeys } from '@/lib/admin-access';

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
      .select('role, custom_permissions')
      .eq('id', ctx.userId)
      .maybeSingle();

    const customPermissions = customPermissionsToKeys(adminUser?.custom_permissions);
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
