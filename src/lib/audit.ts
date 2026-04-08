import { supabaseAdmin } from '@/lib/supabase-admin';

export async function logAdminAction(
  userId: string,
  action: string,
  details: Record<string, unknown>,
  centerId?: string | null
) {
  if (!supabaseAdmin) {
    console.warn('[audit] Missing Supabase admin client - audit log skipped');
    return;
  }

  try {
    await supabaseAdmin.from('audit_log').insert({
      center_id: centerId ?? null,
      user_id: userId,
      action,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[audit] Failed to log action:', action, err);
  }
}
