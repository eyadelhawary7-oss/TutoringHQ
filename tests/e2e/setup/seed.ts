/**
 * Optional DB fixtures for e2e. Extend when SUPABASE_SERVICE_ROLE_KEY + TEST_CENTER_ID are available.
 */
export async function seedE2EDatabase(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return;
  }
  // Placeholder: deterministic students / centres can be upserted here per CI policy.
}
