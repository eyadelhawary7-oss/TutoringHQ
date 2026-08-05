import { describe, expect, it } from 'vitest';
import {
  TEACHER_WA_TEMPLATES,
  TEACHER_WA_TEMPLATE_NAMES,
  TEMPLATE_CLASS_CANCELLED,
  TEMPLATE_CLASS_REMINDER,
  TEMPLATE_CLASS_RESCHEDULED,
  TEMPLATE_FEE_REMINDER,
  TEMPLATE_SCHEDULE_CHANGED,
  anyTeacherWaTemplateDelivers,
  buildTeacherWaTemplateStates,
  resolveTeacherWaDelivery,
} from '@/lib/teacherWhatsappTemplates';

/**
 * The teacher WhatsApp screen states, out loud, whether a parent can actually
 * receive each message. Getting that wrong in the optimistic direction claims a
 * delivery that does not happen, so the rules are pinned here.
 */
describe('resolveTeacherWaDelivery', () => {
  it('treats a missing template row as never submitted, not as pending', () => {
    expect(resolveTeacherWaDelivery(null, true)).toBe('notSubmitted');
    expect(resolveTeacherWaDelivery(undefined, true)).toBe('notSubmitted');
    expect(resolveTeacherWaDelivery('', true)).toBe('notSubmitted');
  });

  it('reports PENDING and IN_REVIEW as awaiting approval', () => {
    expect(resolveTeacherWaDelivery('PENDING', true)).toBe('awaitingApproval');
    expect(resolveTeacherWaDelivery('IN_REVIEW', true)).toBe('awaitingApproval');
  });

  it('reports REJECTED distinctly', () => {
    expect(resolveTeacherWaDelivery('REJECTED', true)).toBe('rejected');
  });

  it('only the exact string APPROVED can read as delivering', () => {
    expect(resolveTeacherWaDelivery('APPROVED', true)).toBe('sending');
    // Mirrors isTemplateApproved: anything else, however approving it looks,
    // must not be shown as delivering.
    for (const near of ['approved', 'Approved', 'APPROVED ', 'ACTIVE', 'OK']) {
      expect(resolveTeacherWaDelivery(near, true)).toBe('awaitingApproval');
    }
  });

  it('an approved template with the platform switch off is paused, not delivering', () => {
    expect(resolveTeacherWaDelivery('APPROVED', false)).toBe('sendingPaused');
  });

  it('the kill switch never upgrades an unapproved template', () => {
    expect(resolveTeacherWaDelivery('PENDING', false)).toBe('awaitingApproval');
    expect(resolveTeacherWaDelivery(null, false)).toBe('notSubmitted');
  });
});

describe('the teacher template catalog', () => {
  it('lists exactly the five templates the teacher send paths use', () => {
    expect(TEACHER_WA_TEMPLATE_NAMES).toEqual([
      TEMPLATE_FEE_REMINDER,
      TEMPLATE_CLASS_REMINDER,
      TEMPLATE_SCHEDULE_CHANGED,
      TEMPLATE_CLASS_CANCELLED,
      TEMPLATE_CLASS_RESCHEDULED,
    ]);
  });

  it('uses the exact Meta template names, which are the wa_meta_templates keys', () => {
    expect(TEMPLATE_FEE_REMINDER).toBe('chq_fee_reminder');
    expect(TEMPLATE_CLASS_REMINDER).toBe('chq_class_reminder');
    expect(TEMPLATE_SCHEDULE_CHANGED).toBe('chq_schedule_changed');
    expect(TEMPLATE_CLASS_CANCELLED).toBe('chq_class_cancelled');
    expect(TEMPLATE_CLASS_RESCHEDULED).toBe('chq_class_rescheduled');
  });

  it('gives every template a unique i18n/React key', () => {
    const keys = TEACHER_WA_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildTeacherWaTemplateStates', () => {
  it('keeps the raw status and never invents one for an absent row', () => {
    const states = buildTeacherWaTemplateStates({ [TEMPLATE_FEE_REMINDER]: 'PENDING' }, true);
    expect(states).toHaveLength(5);

    const fee = states.find((s) => s.templateName === TEMPLATE_FEE_REMINDER);
    expect(fee?.status).toBe('PENDING');
    expect(fee?.delivery).toBe('awaitingApproval');

    // The four schedule templates have no wa_meta_templates row at all.
    for (const name of [
      TEMPLATE_CLASS_REMINDER,
      TEMPLATE_SCHEDULE_CHANGED,
      TEMPLATE_CLASS_CANCELLED,
      TEMPLATE_CLASS_RESCHEDULED,
    ]) {
      const row = states.find((s) => s.templateName === name);
      expect(row?.status).toBeNull();
      expect(row?.delivery).toBe('notSubmitted');
    }
  });

  it('preserves the catalog order', () => {
    const states = buildTeacherWaTemplateStates({}, true);
    expect(states.map((s) => s.templateName)).toEqual([...TEACHER_WA_TEMPLATE_NAMES]);
  });

  it('reports that nothing delivers when nothing is approved', () => {
    const states = buildTeacherWaTemplateStates({ [TEMPLATE_FEE_REMINDER]: 'PENDING' }, true);
    expect(anyTeacherWaTemplateDelivers(states)).toBe(false);
  });

  it('reports delivery once a template is approved and sending is on', () => {
    const states = buildTeacherWaTemplateStates({ [TEMPLATE_FEE_REMINDER]: 'APPROVED' }, true);
    expect(anyTeacherWaTemplateDelivers(states)).toBe(true);
    expect(anyTeacherWaTemplateDelivers(buildTeacherWaTemplateStates(
      { [TEMPLATE_FEE_REMINDER]: 'APPROVED' },
      false,
    ))).toBe(false);
  });

  it('ignores an inherited-property lookalike rather than treating it as a row', () => {
    // Object.prototype has 'constructor'; a naive lookup would resolve it.
    const states = buildTeacherWaTemplateStates({}, true);
    expect(states.every((s) => s.status === null)).toBe(true);
  });
});
