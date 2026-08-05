import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { waSendingEnabled } from '@/lib/centerNotify';
import {
  TEACHER_WA_TEMPLATE_NAMES,
  buildTeacherWaTemplateStates,
} from '@/lib/teacherWhatsappTemplates';

const ROUTE_TAG = 'api/teacher/whatsapp/templates';

/**
 * GET /api/teacher/whatsapp/templates
 *
 * The "Your messages" list on Merged-Teacher-WhatsApp §01: which templates this
 * teacher's students/parents can receive, and whether each one actually
 * delivers today. Read-only — no writes, no money, no CSRF surface.
 *
 * Delivery state is read LIVE from wa_meta_templates, the same table (and the
 * same 'APPROVED'-only rule) that gates every real send via isTemplateApproved.
 * A template with no row is reported as notSubmitted, not as pending: those are
 * genuinely different states and collapsing them would overstate progress.
 *
 * The template read is CORE: a failed query is a 500, never coerced into an
 * empty list, because an empty list here reads as "you have no messages" — a
 * different and wrong statement.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { data: rows, error } = await auth.supabaseAdmin
    .from('wa_meta_templates')
    .select('template_name, status')
    .in('template_name', [...TEACHER_WA_TEMPLATE_NAMES]);

  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'template_status');
      Sentry.captureException(error);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const statusByName: Record<string, string> = {};
  for (const row of (rows ?? []) as { template_name: string; status: string | null }[]) {
    if (row.status) statusByName[row.template_name] = row.status;
  }

  // Platform-wide WhatsApp kill switch, read through the same helper every
  // sender uses (absent row = on, only an explicit `false` is off).
  const sendingEnabled = await waSendingEnabled(auth.supabaseAdmin);

  return NextResponse.json({
    wa_sending_enabled: sendingEnabled,
    templates: buildTeacherWaTemplateStates(statusByName, sendingEnabled).map((t) => ({
      key: t.key,
      template_name: t.templateName,
      trigger: t.trigger,
      status: t.status,
      delivery: t.delivery,
    })),
  });
}
