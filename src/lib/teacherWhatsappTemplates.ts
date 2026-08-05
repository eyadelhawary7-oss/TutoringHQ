/**
 * The WhatsApp templates a TEACHER's own students/parents can receive, and the
 * live delivery state of each — the data behind `Merged-Teacher-WhatsApp` §01's
 * "Your messages" list.
 *
 * ── ONE SOURCE OF TRUTH FOR THE NAMES ───────────────────────────────────────
 * Every name below is the name a real sender in this codebase actually passes
 * to Meta. The senders import them from here rather than re-declaring string
 * literals, so the screen can never list a template the code does not send, and
 * a rename cannot drift the two apart:
 *   - chq_fee_reminder      → src/lib/teacherFeeReminder.ts (re-exported as
 *                             FEE_REMINDER_TEMPLATE), used by the nightly
 *                             /api/cron/fee-reminders and by the manual
 *                             POST /api/teacher/private/students/[id]/send-reminder.
 *   - the other four        → src/lib/teacherScheduleNotifications.ts, called
 *                             from the private-group schedule routes and from
 *                             /api/cron/class-reminders.
 *
 * ── WHY DELIVERY STATE IS SHOWN AT ALL ──────────────────────────────────────
 * Meta approval is an external gate every send is already checked against
 * (`isTemplateApproved`, wa_meta_templates.status === 'APPROVED'). Four of the
 * five templates below have no wa_meta_templates row at production today and
 * the fifth is PENDING, so the honest answer to "what do parents receive?" is
 * currently "nothing yet, for these named reasons". Printing an approved-looking
 * template list would claim delivery that does not happen. Same principle as
 * the disabled Send-reminder button on Merged-Teacher-Students §02, which
 * prints its block reason instead of pretending.
 */

export const TEMPLATE_FEE_REMINDER = 'chq_fee_reminder';
export const TEMPLATE_CLASS_REMINDER = 'chq_class_reminder';
export const TEMPLATE_SCHEDULE_CHANGED = 'chq_schedule_changed';
export const TEMPLATE_CLASS_CANCELLED = 'chq_class_cancelled';
export const TEMPLATE_CLASS_RESCHEDULED = 'chq_class_rescheduled';

/** How a template is triggered. `autoAndManual` = a cron plus a teacher-pressed button. */
export type TeacherWaTrigger = 'auto' | 'autoAndManual';

export type TeacherWaTemplate = {
  /** i18n key under teacherPortal.whatsapp.templates.*; also the React key. */
  key: string;
  templateName: string;
  trigger: TeacherWaTrigger;
};

/**
 * Listed in the order a teacher meets them: money first (the one they press
 * themselves), then the schedule messages that fire on their own.
 */
export const TEACHER_WA_TEMPLATES: readonly TeacherWaTemplate[] = [
  { key: 'feeReminder', templateName: TEMPLATE_FEE_REMINDER, trigger: 'autoAndManual' },
  { key: 'classReminder', templateName: TEMPLATE_CLASS_REMINDER, trigger: 'auto' },
  { key: 'scheduleChanged', templateName: TEMPLATE_SCHEDULE_CHANGED, trigger: 'auto' },
  { key: 'classCancelled', templateName: TEMPLATE_CLASS_CANCELLED, trigger: 'auto' },
  { key: 'classRescheduled', templateName: TEMPLATE_CLASS_RESCHEDULED, trigger: 'auto' },
];

/** Every template name the teacher screen reports on. */
export const TEACHER_WA_TEMPLATE_NAMES: readonly string[] = TEACHER_WA_TEMPLATES.map(
  (t) => t.templateName,
);

/**
 * What a teacher is told about one template.
 *   sending          — Meta-approved and the platform switch is on: it delivers.
 *   sendingPaused    — Meta-approved but `wa_sending_enabled` is explicitly false.
 *   awaitingApproval — submitted to Meta, not approved yet (PENDING / IN_REVIEW).
 *   rejected         — Meta said no.
 *   notSubmitted     — no wa_meta_templates row at all; never submitted.
 */
export type TeacherWaDelivery =
  | 'sending'
  | 'sendingPaused'
  | 'awaitingApproval'
  | 'rejected'
  | 'notSubmitted';

/**
 * Map one live `wa_meta_templates.status` (or its absence) to what the teacher
 * is told. Mirrors `isTemplateApproved`: ONLY the exact string 'APPROVED' counts
 * as approved, so an unrecognised status can never read as deliverable.
 *
 * `waSendingEnabled` is the platform-wide kill switch (`platform_config`
 * .wa_sending_enabled); an absent row reads as on, matching `waSendingEnabled()`.
 */
export function resolveTeacherWaDelivery(
  status: string | null | undefined,
  waSendingEnabled: boolean,
): TeacherWaDelivery {
  if (status === null || status === undefined || status === '') return 'notSubmitted';
  if (status === 'REJECTED') return 'rejected';
  if (status !== 'APPROVED') return 'awaitingApproval';
  return waSendingEnabled ? 'sending' : 'sendingPaused';
}

export type TeacherWaTemplateState = TeacherWaTemplate & {
  /** The raw live status, or null when the template has no row. Never inferred. */
  status: string | null;
  delivery: TeacherWaDelivery;
};

/**
 * Build the full list for the screen. `statusByName` holds ONLY the rows that
 * actually came back from wa_meta_templates — a name missing from the map is a
 * template with no row, which is a different (and earlier) failure than a
 * pending one, and is reported as such.
 */
export function buildTeacherWaTemplateStates(
  statusByName: Readonly<Record<string, string>>,
  waSendingEnabled: boolean,
): TeacherWaTemplateState[] {
  return TEACHER_WA_TEMPLATES.map((tpl) => {
    const status = Object.prototype.hasOwnProperty.call(statusByName, tpl.templateName)
      ? statusByName[tpl.templateName]
      : null;
    return {
      ...tpl,
      status: status ?? null,
      delivery: resolveTeacherWaDelivery(status, waSendingEnabled),
    };
  });
}

/** True when at least one template can actually reach a parent right now. */
export function anyTeacherWaTemplateDelivers(states: readonly TeacherWaTemplateState[]): boolean {
  return states.some((s) => s.delivery === 'sending');
}
