import 'server-only';

/** When false, admin aggregates should exclude rows where centers.is_test is true. */
export function parseIncludeTestCenters(request: Request): boolean {
  try {
    const u = new URL(request.url);
    return u.searchParams.get('include_test') === '1';
  } catch {
    return false;
  }
}
