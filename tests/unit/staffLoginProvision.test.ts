import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mintForFallbackMock, sendPinSetupLinkMock } = vi.hoisted(() => ({
  mintForFallbackMock: vi.fn(),
  sendPinSetupLinkMock: vi.fn(),
}));

vi.mock('@/lib/pinSetupTokens', () => ({ mintForFallback: mintForFallbackMock }));
vi.mock('@/lib/centerNotify', () => ({ sendPinSetupLink: sendPinSetupLinkMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { provisionStaffLogin } from '@/lib/staffLoginProvision';

function makeAdmin(createdId: string | null) {
  const deleteUser = vi.fn().mockResolvedValue({ error: null });
  const createUser = vi.fn().mockResolvedValue(
    createdId ? { data: { user: { id: createdId } }, error: null } : { data: null, error: new Error('boom') },
  );
  const admin = { auth: { admin: { createUser, deleteUser } } } as unknown as SupabaseClient;
  return { admin, createUser, deleteUser };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendPinSetupLinkMock.mockResolvedValue(true);
});

describe('provisionStaffLogin', () => {
  it('happy path: creates the auth user, mints a link, returns { userId, setupUrl }', async () => {
    mintForFallbackMock.mockResolvedValue({ rowId: 'r1', plaintext: 'TOKEN123' });
    const { admin, createUser, deleteUser } = makeAdmin('new-uid');

    const res = await provisionStaffLogin(admin, { phone: '+201234567890', name: 'Rep One' });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: '201234567890@centerhq.local', email_confirm: true }),
    );
    expect(res.userId).toBe('new-uid');
    expect(res.setupUrl).toContain('/set-pin?t=TOKEN123');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('ROLLS BACK the orphan auth user when the set-PIN grant fails after create', async () => {
    mintForFallbackMock.mockRejectedValue(new Error('insert failed'));
    const { admin, deleteUser } = makeAdmin('new-uid');

    await expect(provisionStaffLogin(admin, { phone: '+201234567890', name: 'Rep One' })).rejects.toThrow();
    // The just-created auth identity is deleted so the phone can be re-added.
    expect(deleteUser).toHaveBeenCalledWith('new-uid');
  });

  it('throws (no rollback needed) when auth create itself fails', async () => {
    const { admin, deleteUser } = makeAdmin(null);
    await expect(provisionStaffLogin(admin, { phone: '+201234567890' })).rejects.toThrow();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('rejects a missing/blank phone before touching auth', async () => {
    const { admin, createUser } = makeAdmin('new-uid');
    await expect(provisionStaffLogin(admin, { phone: '   ' })).rejects.toThrow();
    expect(createUser).not.toHaveBeenCalled();
  });
});
