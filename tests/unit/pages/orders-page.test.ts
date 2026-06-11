import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const usersCoreMaybeSingle = vi.fn();
const usersPermsMaybeSingle = vi.fn();
const centersMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: (cols: string) => {
            const isPermsSelect = cols.includes('can_');
            return {
              eq: () => ({
                maybeSingle: isPermsSelect ? usersPermsMaybeSingle : usersCoreMaybeSingle,
              }),
            };
          },
        };
      }
      if (table === 'centers') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: centersMaybeSingle }) }),
        };
      }
      throw new Error(`unexpected table in orders-page test mock: ${table}`);
    },
  },
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    async ({ namespace }: { namespace: string }) =>
      (key: string) =>
        `${namespace}.${key}`,
  ),
}));

vi.mock('@/i18n/routing', () => ({
  Link: () => null,
}));

vi.mock('@/lib/bostaShipping', () => ({
  getShippingFee: vi.fn(() => 50),
  getShippingZone: vi.fn(() => 'Cairo'),
}));

vi.mock('@/lib/loadBostaShippingRates', () => ({
  loadBostaShippingRates: vi.fn(async () => null),
}));

vi.mock('@/app/[locale]/(dashboard)/orders/OrdersPageClient', () => ({
  default: vi.fn(() => null),
}));

import * as Sentry from '@sentry/nextjs';
import OrdersPageClient from '@/app/[locale]/(dashboard)/orders/OrdersPageClient';
import OrdersPage from '@/app/[locale]/(dashboard)/orders/page';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';

type AnyElement = { type: unknown; props: Record<string, unknown> } | null;

function renderPage(): Promise<AnyElement> {
  return OrdersPage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({}),
  }) as unknown as Promise<AnyElement>;
}

/** Walk a React element tree and collect every string/number leaf. */
function collectText(node: unknown, acc: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return acc;
  if (typeof node === 'string' || typeof node === 'number') {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, acc);
    return acc;
  }
  if (typeof node === 'object' && 'props' in (node as object)) {
    collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  }
  return acc;
}

beforeEach(() => {
  mockGetUser.mockReset();
  usersCoreMaybeSingle.mockReset();
  usersPermsMaybeSingle.mockReset();
  centersMaybeSingle.mockReset();
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  centersMaybeSingle.mockResolvedValue({ data: { governorate: 'Cairo' }, error: null });
});

describe('OrdersPage — Rule 151 CORE+best-effort split (fail-open bypass fix)', () => {
  it('CORE select error -> renders error state, NOT the orders page (no fail-open)', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'cache stale: column missing', code: '42703' },
    });

    const result = await renderPage();
    const texts = collectText(result);

    expect(result?.type).not.toBe(OrdersPageClient);
    expect(texts).toContain('permissions.loadError.title');
    expect(texts).toContain('permissions.loadError.message');
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
  });

  it('PERMISSIONS select error -> renders restricted state (fail CLOSED), Sentry warning', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID, role: 'assistant' },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'column "can_place_card_orders" does not exist', code: '42703' },
    });

    const result = await renderPage();
    const texts = collectText(result);

    expect(result?.type).not.toBe(OrdersPageClient);
    expect(texts).toContain('permissions.ownerOnly.title');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('permission-column lookup failed'),
      'warning',
    );
  });

  it('happy path: can_place_card_orders = true -> renders orders page', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID, role: 'assistant' },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_place_card_orders: true },
      error: null,
    });

    const result = await renderPage();

    expect(result?.type).toBe(OrdersPageClient);
    expect(result?.props.initialShippingQuote).toEqual({
      hasGovernorate: true,
      fee: 50,
      zoneEn: 'Cairo',
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('can_place_card_orders = false (explicit, no error) -> restricted state, no bypass', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID, role: 'assistant' },
      error: null,
    });
    usersPermsMaybeSingle.mockResolvedValue({
      data: { can_place_card_orders: false },
      error: null,
    });

    const result = await renderPage();
    const texts = collectText(result);

    expect(result?.type).not.toBe(OrdersPageClient);
    expect(texts).toContain('permissions.ownerOnly.title');
  });

  it('privileged role (owner) skips the PERMISSIONS select and renders orders page', async () => {
    usersCoreMaybeSingle.mockResolvedValue({
      data: { id: USER_ID, center_id: CENTER_ID, role: 'owner' },
      error: null,
    });

    const result = await renderPage();

    expect(result?.type).toBe(OrdersPageClient);
    expect(usersPermsMaybeSingle).not.toHaveBeenCalled();
  });
});
