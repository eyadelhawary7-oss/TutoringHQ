// Sync WhatsApp template names/status/variable-counts from the Meta Graph API
// into wa_meta_templates — the mirror every template-gated send checks via
// isTemplateApproved. If this mirror is stale, approved templates silently
// skip, so it is synced two ways: the super-admin button
// (/api/admin/whatsapp/sync-templates) and the hourly cron
// (/api/cron/sync-wa-templates).
//
// Template listing lives on the WhatsApp BUSINESS ACCOUNT edge
// (GET /{WABA_ID}/message_templates), NOT the phone-number id — the same edge
// scripts/submit-dormancy-wa-templates.mjs submits to.

import type { SupabaseClient } from '@supabase/supabase-js';

const GRAPH_VERSION = 'v18.0';

export function waBusinessAccountId(): string | null {
  return process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
}

export function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

/** Collapse Meta's status vocabulary onto the wa_meta_templates CHECK values. */
export function mapMetaStatus(raw: string | undefined): string {
  const u = (raw || '').toUpperCase();
  if (u === 'APPROVED') return 'APPROVED';
  if (u === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

type MetaTemplateComponent = { type?: string; text?: string };

export type MetaTemplateRow = {
  name?: string;
  status?: string;
  category?: string;
  components?: MetaTemplateComponent[];
};

/**
 * Highest {{n}} placeholder index in the template's BODY component, or null
 * when Meta returned no body text (then the existing DB value is preserved).
 */
export function bodyVariablesCount(row: MetaTemplateRow): number | null {
  const body = (row.components ?? []).find(
    (c) => (c.type || '').toUpperCase() === 'BODY',
  );
  if (typeof body?.text !== 'string') return null;
  let max = 0;
  for (const m of body.text.matchAll(/\{\{(\d+)\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

export type WaTemplateSyncResult =
  | { ok: true; fetched: number; upserted: number; errors?: string[] }
  | { ok: false; error: string; status: 500 | 502 };

export async function syncWaMetaTemplates(
  admin: SupabaseClient,
): Promise<WaTemplateSyncResult> {
  const wabaId = waBusinessAccountId();
  const token = waToken();
  if (!wabaId || !token) {
    return {
      ok: false,
      status: 500,
      error: 'WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_TOKEN must be set',
    };
  }

  const collected: MetaTemplateRow[] = [];
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates` +
    `?limit=100&fields=name,status,category,components`;

  try {
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json()) as {
        data?: MetaTemplateRow[];
        paging?: { next?: string };
        error?: { message?: string };
      };

      if (!res.ok) {
        const msg = json.error?.message ?? `HTTP ${res.status}`;
        console.error('[waTemplateSync] Graph error:', msg);
        return { ok: false, status: 502, error: msg };
      }

      for (const row of json.data ?? []) collected.push(row);
      url = json.paging?.next ?? null;
    }
  } catch (e) {
    console.error('[waTemplateSync] fetch failed:', e);
    return { ok: false, status: 502, error: 'Failed to reach Meta Graph API' };
  }

  const now = new Date().toISOString();
  let upserted = 0;
  const errors: string[] = [];

  for (const row of collected) {
    const templateName = row.name;
    if (!templateName) continue;

    const payload: Record<string, unknown> = {
      template_name: templateName,
      status: mapMetaStatus(row.status),
      category: (row.category || 'UTILITY').toString().toUpperCase(),
      updated_at: now,
    };
    // Only write variables_count when Meta returned a body to count — never
    // clobber a known count with 0 on a metadata-only response.
    const varCount = bodyVariablesCount(row);
    if (varCount !== null) payload.variables_count = varCount;

    const { error } = await admin
      .from('wa_meta_templates')
      .upsert(payload, { onConflict: 'template_name' });

    if (error) {
      errors.push(`${templateName}: ${error.message}`);
    } else {
      upserted += 1;
    }
  }

  return {
    ok: true,
    fetched: collected.length,
    upserted,
    errors: errors.length ? errors : undefined,
  };
}
