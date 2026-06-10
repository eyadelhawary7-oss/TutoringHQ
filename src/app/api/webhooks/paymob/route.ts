/** Deprecated URL - use `/api/paymob/webhook`. Kept for upstream dashboards until rotated. */
export async function POST() {
  return new Response(null, { status: 410 });
}
