import type { SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendNudgeWhatsapp } from '@/lib/nudges/send';
import { formatDate } from '@/lib/formatNumber';
import {
  TEMPLATE_CLASS_CANCELLED,
  TEMPLATE_CLASS_REMINDER,
  TEMPLATE_CLASS_RESCHEDULED,
  TEMPLATE_SCHEDULE_CHANGED,
} from '@/lib/teacherWhatsappTemplates';

/**
 * WhatsApp notifications for the teacher schedule feature — sent to the enrolled
 * students of a teacher's PRIVATE group when the schedule changes or a class is
 * coming up.
 *
 * Send + gate pattern (reused, not invented):
 *   - Gate on Meta template approval via `isTemplateApproved` (wa_meta_templates
 *     .status === 'APPROVED') — the same gate fee-reminders / nudges use.
 *   - Send via `sendNudgeWhatsapp` (the raw center-less template sender used by
 *     billing nudges). We deliberately do NOT use whatsapp/client.sendTemplateMessage
 *     here: it logs every send to wa_message_queue whose center_id is uuid NOT NULL,
 *     and a private group's students are center-less (student_groups.center_id and
 *     students.center_id are nullable), so that path cannot hold these sends.
 *
 * Until the four templates below are Meta-approved (on the submission list), the
 * approval gate short-circuits every call: no send is attempted and the caller
 * (route or cron) proceeds normally. This is the expected "hold cleanly" state.
 *
 * Template body parameters are POSITIONAL. The exact parameter list must match the
 * final Meta-approved template body — reconcile the buildParams arrays below with
 * the approved templates before flipping them live. While unapproved, a param
 * mismatch cannot reach Meta (the gate holds), so this is safe to land now.
 */

// Names live in the shared catalog (src/lib/teacherWhatsappTemplates.ts) so the
// teacher's WhatsApp screen reports on exactly the templates this file sends.
const TEMPLATES = {
  scheduleChanged: TEMPLATE_SCHEDULE_CHANGED,
  classCancelled: TEMPLATE_CLASS_CANCELLED,
  classRescheduled: TEMPLATE_CLASS_RESCHEDULED,
  classReminder: TEMPLATE_CLASS_REMINDER,
} as const;

type RosterRecipient = { phone: string; studentName: string };

/** Arabic, Cairo-timezone day string for a YYYY-MM-DD schedule date. */
function formatClassDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const dt = new Date(`${ymd}T12:00:00.000Z`);
  return formatDate(dt, 'ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Cairo',
  });
}

/**
 * Enrolled roster (active/pending) with the payer-appropriate WhatsApp number:
 * the parent's number when the enrollment payer is 'parent', otherwise the
 * student's own number (falling back to whichever is present).
 */
async function loadRosterRecipients(
  admin: SupabaseClient,
  groupId: string,
): Promise<RosterRecipient[]> {
  const { data: enr } = await admin
    .from('enrollments')
    .select('student_id, payer, status')
    .eq('group_id', groupId)
    .in('status', ['pending', 'active']);
  const enrollments = (enr as { student_id: string; payer: string | null }[] | null) ?? [];
  if (enrollments.length === 0) return [];

  const payerByStudent = new Map<string, string | null>();
  for (const e of enrollments) payerByStudent.set(e.student_id, e.payer);

  const { data: studs } = await admin
    .from('students')
    .select('id, name, phone, parent_phone')
    .in('id', [...payerByStudent.keys()]);
  const students =
    (studs as { id: string; name: string | null; phone: string | null; parent_phone: string | null }[] | null) ??
    [];

  const recipients: RosterRecipient[] = [];
  const seenPhones = new Set<string>();
  for (const s of students) {
    const payer = payerByStudent.get(s.id);
    const chosen = payer === 'parent' ? s.parent_phone ?? s.phone : s.phone ?? s.parent_phone;
    const phone = (chosen ?? '').trim();
    if (!phone) continue;
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    recipients.push({ phone, studentName: (s.name ?? '').trim() });
  }
  return recipients;
}

/** Ownership-checked private-group context (name), or null if not the teacher's private group. */
async function loadPrivateGroupContext(
  admin: SupabaseClient,
  groupId: string,
  teacherUserId: string,
): Promise<{ name: string } | null> {
  const { data } = await admin
    .from('student_groups')
    .select('name, teacher_id, kind')
    .eq('id', groupId)
    .maybeSingle();
  const g = data as { name: string | null; teacher_id: string | null; kind: string | null } | null;
  if (!g || g.teacher_id !== teacherUserId || g.kind !== 'private') return null;
  return { name: (g.name ?? '').trim() };
}

/**
 * Gate on template approval, then send `templateName` to every roster recipient.
 * Returns counts for observability. Never throws: a per-recipient send failure is
 * logged and counted, so one bad number cannot abort the rest of the blast.
 */
async function blastToRoster(
  admin: SupabaseClient,
  groupId: string,
  templateName: string,
  buildParams: (r: RosterRecipient) => string[],
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!(await isTemplateApproved(templateName, admin))) {
    // Expected until Meta approves the template — hold cleanly, no send attempted.
    return { sent: 0, failed: 0, skipped: true };
  }
  const recipients = await loadRosterRecipients(admin, groupId);
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await sendNudgeWhatsapp({ toPhone: r.phone, templateName, params: buildParams(r) });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[teacherScheduleNotifications] send failed (${templateName}):`, err);
    }
  }
  return { sent, failed, skipped: false };
}

export async function queueScheduleChangedNotification(
  groupId: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  const ctx = await loadPrivateGroupContext(adminClient, groupId, teacherUserId);
  if (!ctx) return;
  await blastToRoster(adminClient, groupId, TEMPLATES.scheduleChanged, (r) => [r.studentName, ctx.name]);
}

export async function queueClassCancelledNotification(
  groupId: string,
  exceptionDate: string, // YYYY-MM-DD
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  const ctx = await loadPrivateGroupContext(adminClient, groupId, teacherUserId);
  if (!ctx) return;
  const dateStr = formatClassDate(exceptionDate);
  await blastToRoster(adminClient, groupId, TEMPLATES.classCancelled, (r) => [r.studentName, ctx.name, dateStr]);
}

export async function queueClassRescheduledNotification(
  groupId: string,
  exceptionDate: string,
  newDate: string,
  newTimeStart: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  const ctx = await loadPrivateGroupContext(adminClient, groupId, teacherUserId);
  if (!ctx) return;
  const fromStr = formatClassDate(exceptionDate);
  const toStr = formatClassDate(newDate);
  await blastToRoster(adminClient, groupId, TEMPLATES.classRescheduled, (r) => [
    r.studentName,
    ctx.name,
    fromStr,
    toStr,
    (newTimeStart ?? '').trim(),
  ]);
}

export async function queueClassReminderNotification(
  groupId: string,
  scheduleDate: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  const ctx = await loadPrivateGroupContext(adminClient, groupId, teacherUserId);
  if (!ctx) return;
  const dateStr = formatClassDate(scheduleDate);
  await blastToRoster(adminClient, groupId, TEMPLATES.classReminder, (r) => [r.studentName, ctx.name, dateStr]);
}
