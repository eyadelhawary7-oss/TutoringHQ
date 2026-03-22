import { createClient } from '@supabase/supabase-js';

export async function logAdminAction(
  userId: string,
  action: string,
  details: Record<string, unknown>,
  centerId?: string | null
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn('[audit] Missing Supabase config - audit log skipped');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await supabase.from('audit_log').insert({
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
