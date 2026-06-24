/**
 * Allowlist of routes a suspended centre owner may still reach. Kept tight: exact
 * `/reactivate` (standalone pay page), `/pay` (the customer invoices / pay page,
 * where a locked customer pays the outstanding invoice to unlock), and the
 * existing `/suspended` landing, each with their direct sub-trees. No broad string
 * prefix that could accidentally exempt sibling routes such as `/reactivate-foo`,
 * `/payments`, or `/suspended-archive`.
 *
 * Re-exported from `src/proxy.ts`; this file is kept dependency-free so it can be
 * unit-tested without booting next-intl middleware.
 */
export function isSuspendedRouteExempt(cleanPath: string): boolean {
  return (
    cleanPath === '/suspended' ||
    cleanPath.startsWith('/suspended/') ||
    cleanPath === '/reactivate' ||
    cleanPath.startsWith('/reactivate/') ||
    cleanPath === '/pay' ||
    cleanPath.startsWith('/pay/')
  );
}
