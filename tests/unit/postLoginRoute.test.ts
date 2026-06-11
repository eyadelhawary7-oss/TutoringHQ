import { describe, it, expect } from 'vitest';
import { decidePostLoginRoute } from '@/lib/postLoginRoute';

describe('decidePostLoginRoute', () => {
  it("role='teacher' (center_id null) -> /teacher, before any center_id check", () => {
    const d = decidePostLoginRoute({
      role: 'teacher',
      isAdmin: false,
      centerId: null,
      needsOnboarding: false,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/teacher' });
  });

  it("role='teacher' wins even when a center_id is somehow present (Model B)", () => {
    const d = decidePostLoginRoute({
      role: 'teacher',
      isAdmin: false,
      centerId: 'center-1',
      needsOnboarding: false,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/teacher' });
  });

  it("role='owner' with center_id -> /dashboard", () => {
    const d = decidePostLoginRoute({
      role: 'owner',
      isAdmin: false,
      centerId: 'center-1',
      needsOnboarding: false,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/dashboard' });
  });

  it('super_admin (isAdmin) -> /admin', () => {
    const d = decidePostLoginRoute({
      role: 'super_admin',
      isAdmin: true,
      centerId: null,
      needsOnboarding: false,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/admin' });
  });

  it('center member who needs onboarding -> /onboarding', () => {
    const d = decidePostLoginRoute({
      role: 'owner',
      isAdmin: false,
      centerId: 'center-1',
      needsOnboarding: true,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/onboarding' });
  });

  it('no center, contactSales -> contactSales (shown as login error, no redirect)', () => {
    const d = decidePostLoginRoute({
      role: 'assistant',
      isAdmin: false,
      centerId: null,
      needsOnboarding: false,
      contactSales: true,
    });
    expect(d).toEqual({ kind: 'contactSales' });
  });

  it('no center, no contactSales -> /onboarding (fallback)', () => {
    const d = decidePostLoginRoute({
      role: null,
      isAdmin: false,
      centerId: null,
      needsOnboarding: false,
      contactSales: false,
    });
    expect(d).toEqual({ kind: 'route', path: '/onboarding' });
  });
});
