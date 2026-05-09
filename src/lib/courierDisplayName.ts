import type { SupabaseClient } from '@supabase/supabase-js'

const FALLBACK = 'Bosta'

/** Reads `platform_config.courier_name` (jsonb string); defaults for vendor WA template. */
export async function getCourierDisplayName(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'courier_name')
    .maybeSingle()

  const v = data?.value as unknown
  if (typeof v === 'string' && v.trim()) return v.trim()
  return FALLBACK
}
