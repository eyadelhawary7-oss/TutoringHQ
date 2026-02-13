import { createClient, SupabaseClient } from '@supabase/supabase-js';

function isSuperAdmin(phone: string | null): boolean {
  const admins = process.env.SUPER_ADMIN_PHONES || '';
  return !!phone && admins.split(',').map((p: string) => p.trim()).includes(phone);
}

export async function getAdminContext(request: Request): Promise<{
  userId: string;
  supabaseAdmin: SupabaseClient;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminByTable = await supabaseAdmin
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .single();

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('phone')
    .eq('id', user.id)
    .single();

  const adminByPhone = isSuperAdmin(userRecord?.phone ?? null);

  if (!adminByTable.data && !adminByPhone) return null;

  return { userId: user.id, supabaseAdmin };
}
