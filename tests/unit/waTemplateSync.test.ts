import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  syncWaMetaTemplates,
  bodyVariablesCount,
  mapMetaStatus,
} from '@/lib/waTemplateSync';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('mapMetaStatus', () => {
  it('collapses Meta statuses onto the wa_meta_templates CHECK values', () => {
    expect(mapMetaStatus('APPROVED')).toBe('APPROVED');
    expect(mapMetaStatus('approved')).toBe('APPROVED');
    expect(mapMetaStatus('REJECTED')).toBe('REJECTED');
    expect(mapMetaStatus('PENDING')).toBe('PENDING');
    expect(mapMetaStatus('IN_APPEAL')).toBe('PENDING');
    expect(mapMetaStatus('PAUSED')).toBe('PENDING');
    expect(mapMetaStatus(undefined)).toBe('PENDING');
  });
});

describe('bodyVariablesCount', () => {
  it('counts the highest {{n}} placeholder in the BODY component', () => {
    expect(
      bodyVariablesCount({
        components: [
          { type: 'HEADER', text: '{{1}}' },
          { type: 'BODY', text: 'كود تسجيلك في مجموعة {{1}}: {{2}}. صالح ١٠ دقايق.' },
        ],
      }),
    ).toBe(2);
  });

  it('returns 0 for a body without placeholders', () => {
    expect(bodyVariablesCount({ components: [{ type: 'BODY', text: 'ثابت' }] })).toBe(0);
  });

  it('returns null when Meta returned no body text (preserve DB value)', () => {
    expect(bodyVariablesCount({})).toBeNull();
    expect(bodyVariablesCount({ components: [{ type: 'BUTTONS' }] })).toBeNull();
  });
});

describe('syncWaMetaTemplates', () => {
  const upserts: { payload: Record<string, unknown>; opts: unknown }[] = [];
  const admin = {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, opts: unknown) => {
        expect(table).toBe('wa_meta_templates');
        upserts.push({ payload, opts });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;

  beforeEach(() => {
    upserts.length = 0;
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'waba-123';
    process.env.WHATSAPP_TOKEN = 'token-abc';
  });

  afterEach(() => {
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    delete process.env.WHATSAPP_TOKEN;
    vi.unstubAllGlobals();
  });

  it('fetches the WABA message_templates edge and upserts status + variable count', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/waba-123/message_templates');
      expect(url).toContain('fields=name,status,category,components');
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'chq_enrollment_otp',
              status: 'APPROVED',
              category: 'utility',
              components: [{ type: 'BODY', text: '{{1}}: {{2}}' }],
            },
            { name: 'chq_pin_setup_link', status: 'IN_APPEAL' },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncWaMetaTemplates(admin);
    expect(result).toMatchObject({ ok: true, fetched: 2, upserted: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(upserts[0].payload).toMatchObject({
      template_name: 'chq_enrollment_otp',
      status: 'APPROVED',
      category: 'UTILITY',
      variables_count: 2,
    });
    // No body returned → variables_count omitted so the DB value is preserved.
    expect(upserts[1].payload).toMatchObject({
      template_name: 'chq_pin_setup_link',
      status: 'PENDING',
    });
    expect(upserts[1].payload).not.toHaveProperty('variables_count');
  });

  it('follows Graph pagination', async () => {
    const page2 = 'https://graph.facebook.com/v18.0/waba-123/message_templates?after=xyz';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ name: 't1', status: 'APPROVED' }],
          paging: { next: page2 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ name: 't2', status: 'REJECTED' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncWaMetaTemplates(admin);
    expect(result).toMatchObject({ ok: true, fetched: 2, upserted: 2 });
    expect(fetchMock).toHaveBeenNthCalledWith(2, page2, expect.anything());
  });

  it('fails with 500 when WABA id / token are not configured', async () => {
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const result = await syncWaMetaTemplates(admin);
    expect(result).toMatchObject({ ok: false, status: 500 });
  });

  it('fails with 502 on a Graph error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Unsupported get request' } }),
      })),
    );
    const result = await syncWaMetaTemplates(admin);
    expect(result).toMatchObject({ ok: false, status: 502, error: 'Unsupported get request' });
    expect(upserts).toHaveLength(0);
  });
});
