/**
 * Pure post-login routing precedence. Extracted from the (client-side) login
 * form so the decision is unit-testable.
 *
 * Order matters - teacher is checked FIRST. Under Model B, teachers are
 * center-less on public.users (center_id is NULL) regardless of how many centres
 * they are active members of, so a NULL center_id is NOT a reliable
 * "send to onboarding" signal for a teacher. They own the /teacher portal.
 *
 * super_admin is sourced from the authoritative /api/admin/check (phone- /
 * admin_users-based), surfaced here as `isAdmin` - never from public.users.role.
 */
export type PostLoginRouteInput = {
  role: string | null;
  isAdmin: boolean;
  centerId: string | null;
  needsOnboarding: boolean;
  contactSales: boolean;
};

export type PostLoginRouteDecision =
  | { kind: 'route'; path: '/teacher' | '/admin' | '/dashboard' | '/onboarding' }
  | { kind: 'contactSales' };

export function decidePostLoginRoute(input: PostLoginRouteInput): PostLoginRouteDecision {
  if (input.role === 'teacher') return { kind: 'route', path: '/teacher' };
  if (input.isAdmin) return { kind: 'route', path: '/admin' };
  if (input.centerId) {
    return { kind: 'route', path: input.needsOnboarding ? '/onboarding' : '/dashboard' };
  }
  if (input.contactSales) return { kind: 'contactSales' };
  return { kind: 'route', path: '/onboarding' };
}
