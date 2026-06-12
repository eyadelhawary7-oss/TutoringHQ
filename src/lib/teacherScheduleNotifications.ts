import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * WhatsApp notification stubs for the teacher schedule feature.
 *
 * These are intentional no-op stubs. Phase 4 fills the bodies when the
 * WhatsApp templates (chq_schedule_changed / chq_class_cancelled /
 * chq_class_rescheduled / chq_class_reminder) are Meta-approved. Each stub
 * logs its arguments so Phase 4 knows the exact call signature without
 * guessing. The adminClient is part of the contract (Phase 4 reads the
 * enrolled roster through it) even though the stubs do not touch it yet.
 */

export async function queueScheduleChangedNotification(
  groupId: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  // Phase 4: send chq_schedule_changed to all enrolled students
  void adminClient;
  console.info('[stub] queueScheduleChangedNotification', { groupId, teacherUserId });
}

export async function queueClassCancelledNotification(
  groupId: string,
  exceptionDate: string, // YYYY-MM-DD
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  // Phase 4: send chq_class_cancelled to enrolled students
  void adminClient;
  console.info('[stub] queueClassCancelledNotification', { groupId, exceptionDate, teacherUserId });
}

export async function queueClassRescheduledNotification(
  groupId: string,
  exceptionDate: string,
  newDate: string,
  newTimeStart: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  // Phase 4: send chq_class_rescheduled to enrolled students
  void adminClient;
  console.info('[stub] queueClassRescheduledNotification', {
    groupId,
    exceptionDate,
    newDate,
    newTimeStart,
    teacherUserId,
  });
}

export async function queueClassReminderNotification(
  groupId: string,
  scheduleDate: string,
  teacherUserId: string,
  adminClient: SupabaseClient,
): Promise<void> {
  // Phase 4: send chq_class_reminder to enrolled students (opt-in, capped)
  void adminClient;
  console.info('[stub] queueClassReminderNotification', { groupId, scheduleDate, teacherUserId });
}
