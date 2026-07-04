import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Job 2: the four class-change notifications must attempt a REAL gated send to the
// enrolled roster when their template is approved, and hold cleanly (no send, no
// throw) when it is not.

const isTemplateApproved = vi.fn();
const sendNudgeWhatsapp = vi.fn();

vi.mock('@/lib/centerNotify', () => ({
  isTemplateApproved: (...args: unknown[]) => isTemplateApproved(...args),
}));
vi.mock('@/lib/nudges/send', () => ({
  sendNudgeWhatsapp: (...args: unknown[]) => sendNudgeWhatsapp(...args),
}));

import {
  queueScheduleChangedNotification,
  queueClassCancelledNotification,
  queueClassRescheduledNotification,
  queueClassReminderNotification,
} from '@/lib/teacherScheduleNotifications';

const TEACHER = 'teacher-1';
const GROUP = 'group-1';

const GROUP_ROW = { name: 'Physics A', teacher_id: TEACHER, kind: 'private' };
const ENROLLMENTS = [
  { student_id: 's1', payer: 'student', status: 'active' },
  { student_id: 's2', payer: 'parent', status: 'active' },
];
const STUDENTS = [
  { id: 's1', name: 'Omar', phone: '+201111111111', parent_phone: '+201999999999' },
  { id: 's2', name: 'Sara', phone: '+201222222222', parent_phone: '+201333333333' },
];

function makeAdmin(overrides?: { group?: unknown }): SupabaseClient {
  const group = overrides && 'group' in overrides ? overrides.group : GROUP_ROW;
  return {
    from(table: string) {
      if (table === 'student_groups') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: group, error: null }) }) }),
        };
      }
      if (table === 'enrollments') {
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: ENROLLMENTS, error: null }) }) }),
        };
      }
      if (table === 'students') {
        return { select: () => ({ in: async () => ({ data: STUDENTS, error: null }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  isTemplateApproved.mockReset();
  sendNudgeWhatsapp.mockReset();
  sendNudgeWhatsapp.mockResolvedValue({ wabaMessageId: 'wamid' });
});

describe('teacher schedule notifications — gated real sends', () => {
  it('schedule-changed: sends to the whole roster when approved (payer-aware phone)', async () => {
    isTemplateApproved.mockResolvedValue(true);
    await queueScheduleChangedNotification(GROUP, TEACHER, makeAdmin());

    expect(isTemplateApproved).toHaveBeenCalledWith('chq_schedule_changed', expect.anything());
    expect(sendNudgeWhatsapp).toHaveBeenCalledTimes(2);
    const calls = sendNudgeWhatsapp.mock.calls.map((c) => c[0]);
    // student payer → student's own phone; parent payer → parent_phone.
    expect(calls.find((c) => c.params[0] === 'Omar')?.toPhone).toBe('+201111111111');
    expect(calls.find((c) => c.params[0] === 'Sara')?.toPhone).toBe('+201333333333');
    // group name is the second positional param.
    expect(calls[0].params[1]).toBe('Physics A');
    expect(calls[0].templateName).toBe('chq_schedule_changed');
  });

  it('cancelled / rescheduled / reminder each attempt a send through the right template', async () => {
    isTemplateApproved.mockResolvedValue(true);

    await queueClassCancelledNotification(GROUP, '2026-07-10', TEACHER, makeAdmin());
    expect(isTemplateApproved).toHaveBeenLastCalledWith('chq_class_cancelled', expect.anything());
    expect(sendNudgeWhatsapp).toHaveBeenCalledTimes(2);

    sendNudgeWhatsapp.mockClear();
    await queueClassRescheduledNotification(GROUP, '2026-07-10', '2026-07-12', '17:00', TEACHER, makeAdmin());
    expect(isTemplateApproved).toHaveBeenLastCalledWith('chq_class_rescheduled', expect.anything());
    const resched = sendNudgeWhatsapp.mock.calls[0][0];
    expect(resched.templateName).toBe('chq_class_rescheduled');
    expect(resched.params).toHaveLength(5); // name, group, from-date, to-date, new-time
    expect(resched.params[4]).toBe('17:00');

    sendNudgeWhatsapp.mockClear();
    await queueClassReminderNotification(GROUP, '2026-07-10', TEACHER, makeAdmin());
    expect(isTemplateApproved).toHaveBeenLastCalledWith('chq_class_reminder', expect.anything());
    expect(sendNudgeWhatsapp).toHaveBeenCalledTimes(2);
    expect(sendNudgeWhatsapp.mock.calls[0][0].templateName).toBe('chq_class_reminder');
  });

  it('holds cleanly when the template is NOT approved: no send, no throw', async () => {
    isTemplateApproved.mockResolvedValue(false);
    await expect(queueScheduleChangedNotification(GROUP, TEACHER, makeAdmin())).resolves.toBeUndefined();
    await queueClassCancelledNotification(GROUP, '2026-07-10', TEACHER, makeAdmin());
    await queueClassRescheduledNotification(GROUP, '2026-07-10', '2026-07-12', '17:00', TEACHER, makeAdmin());
    await queueClassReminderNotification(GROUP, '2026-07-10', TEACHER, makeAdmin());
    expect(sendNudgeWhatsapp).not.toHaveBeenCalled();
  });

  it('does not send for a group the teacher does not own (ownership guard, gate never consulted)', async () => {
    isTemplateApproved.mockResolvedValue(true);
    await queueScheduleChangedNotification(GROUP, 'someone-else', makeAdmin());
    expect(sendNudgeWhatsapp).not.toHaveBeenCalled();
    expect(isTemplateApproved).not.toHaveBeenCalled();
  });

  it('skips a non-private group', async () => {
    isTemplateApproved.mockResolvedValue(true);
    const admin = makeAdmin({ group: { name: 'Center Class', teacher_id: TEACHER, kind: 'center' } });
    await queueScheduleChangedNotification(GROUP, TEACHER, admin);
    expect(sendNudgeWhatsapp).not.toHaveBeenCalled();
  });
});
