/**
 * POST — sync WhatsApp message template names/status from Meta Graph API into wa_meta_templates.
 * super_admin only (Bearer session JWT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';

function phoneNumberId(): string | null {
  return (
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_ID ||
    process.env.PHONE_NUMBER_ID ||
    null
  );
}

function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

function mapMetaStatus(raw: string | undefined): string {
  const u = (raw || '').toUpperCase();
  if (u === 'APPROVED') return 'APPROVED';
  if (u === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

type MetaTemplateRow = {
  name?: string;
  status?: string;
  category?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  const phoneId = phoneNumberId();
  const token = waToken();
  if (!phoneId || !token) {
    return NextResponse.json(
      { error: 'WHATSAPP_PHONE_NUMBER_ID (or WHATSAPP_PHONE_ID) and WHATSAPP_TOKEN must be set' },
      { status: 500 },
    );
  }

  const collected: MetaTemplateRow[] = [];
  let url: string | null =
    `https://graph.facebook.com/v18.0/${phoneId}/message_templates?limit=100`;

  try {
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        data?: MetaTemplateRow[];
        paging?: { next?: string };
        error?: { message?: string };
      };

      if (!res.ok) {
        const msg = json.error?.message ?? `HTTP ${res.status}`;
        console.error('[sync-templates] Graph error:', msg);
        return NextResponse.json({ error: msg }, { status: 502 });
      }

      for (const row of json.data ?? []) {
        collected.push(row);
      }

      url = json.paging?.next ?? null;
    }
  } catch (e) {
    console.error('[sync-templates] fetch failed:', e);
    return NextResponse.json({ error: 'Failed to reach Meta Graph API' }, { status: 502 });
  }

  const now = new Date().toISOString();
  let upserted = 0;
  const errors: string[] = [];

  for (const row of collected) {
    const templateName = row.name;
    if (!templateName) continue;
    const status = mapMetaStatus(row.status);
    const category = (row.category || 'UTILITY').toString().toUpperCase();

    const { error } = await auth.supabaseAdmin.from('wa_meta_templates').upsert(
      {
        template_name: templateName,
        status,
        category,
        variables_count: 0,
        updated_at: now,
      },
      { onConflict: 'template_name' },
    );

    if (error) {
      errors.push(`${templateName}: ${error.message}`);
    } else {
      upserted += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    upserted,
    fetched: collected.length,
    errors: errors.length ? errors : undefined,
  });
}
