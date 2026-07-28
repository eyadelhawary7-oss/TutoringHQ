// src/lib/adminTeacherAccounts.ts
//
// Pure assembly for the admin solo-teacher account list. Kept out of the route
// so the part with the actual failure modes — accounts without a subscription,
// students counted twice, MRR read off a missing row — is testable without a
// database or a mocked Supabase client.
//
// It does no fetching and no gating. The route owns both.

import {
  normalizeTeacher,
  teacherUnifiedStatus,
  type TeacherProfileRow,
  type TeacherSubRow,
  type TeacherUserRow,
  type UnifiedStatus,
} from '@/lib/ownerNormalizer';

export interface AdminTeacherProfileRow extends TeacherProfileRow {
  subject?: string | null;
  created_at?: string | null;
}

export interface AdminTeacherRow {
  id: string;
  name: string | null;
  phone: string | null;
  subject: string | null;
  /** Teacher pricing tier (`plan_key`), or null when there is no subscription. */
  tier: string | null;
  /** Monthly gross in EGP. 0 with no subscription — not null, so sums are safe. */
  monthlyMrr: number;
  status: UnifiedStatus;
  /** Distinct students across every group this teacher runs. */
  studentCount: number;
  groupCount: number;
  /** Account age, for the detail screen's "customer since". */
  createdAt: string | null;
  nextChargeCairoDay: string | null;
  isTest: boolean;
}

export interface AdminTeacherInputs {
  profiles: AdminTeacherProfileRow[];
  subs: TeacherSubRow[];
  users: TeacherUserRow[];
  groups: { id: string; teacher_id: string | null }[];
  members: { student_id: string; group_id: string }[];
}

/**
 * Build one row per teacher ACCOUNT.
 *
 * Driven by `profiles`, never by `subs`. A teacher with no `teacher_subscriptions`
 * row is a real account in a real state (signed up, never subscribed) — verified
 * on the live catalog, where 2 of 3 teacher profiles have no subscription. Every
 * other teacher-facing admin read iterates subscriptions, which is right for
 * renewals and wrong for an account list: it would show a third of the customer
 * base and look correct doing it.
 *
 * Test rows are NOT filtered here — the caller decides, so `include_test=1` stays
 * one place.
 */
export function buildAdminTeacherRows(inputs: AdminTeacherInputs): AdminTeacherRow[] {
  const { profiles, subs, users, groups, members } = inputs;

  const subByTeacher = new Map<string, TeacherSubRow>();
  for (const s of subs) if (s.teacher_id) subByTeacher.set(s.teacher_id, s);

  const userByTeacher = new Map<string, TeacherUserRow>();
  for (const u of users) if (u.id) userByTeacher.set(u.id, u);

  // Students reach a teacher through their groups: student_groups.teacher_id →
  // student_group_members.group_id. There is deliberately no students.teacher_id
  // (checked — it does not exist); a student belongs to a centre or to nobody,
  // and to a teacher only by way of a group.
  const teacherByGroup = new Map<string, string>();
  const groupCountByTeacher = new Map<string, number>();
  for (const g of groups) {
    if (!g.id || !g.teacher_id) continue;
    teacherByGroup.set(g.id, g.teacher_id);
    groupCountByTeacher.set(g.teacher_id, (groupCountByTeacher.get(g.teacher_id) ?? 0) + 1);
  }

  const studentIdsByTeacher = new Map<string, Set<string>>();
  for (const m of members) {
    const teacherId = teacherByGroup.get(m.group_id);
    if (!teacherId || !m.student_id) continue;
    // Distinct: one student in three of a teacher's groups is one student.
    const set = studentIdsByTeacher.get(teacherId) ?? new Set<string>();
    set.add(m.student_id);
    studentIdsByTeacher.set(teacherId, set);
  }

  const rows: AdminTeacherRow[] = [];
  for (const p of profiles) {
    const teacherId = p.user_id;
    if (!teacherId) continue;
    const sub = subByTeacher.get(teacherId) ?? null;
    const user = userByTeacher.get(teacherId) ?? null;

    // normalizeTeacher needs a subscription, so map through it only when one
    // exists and fall back to the profile otherwise.
    const account = sub ? normalizeTeacher(sub, p, user) : null;

    rows.push({
      id: teacherId,
      name: p.display_name ?? user?.name ?? null,
      phone: user?.phone ?? null,
      subject: p.subject ?? null,
      tier: account?.tier ?? null,
      monthlyMrr: account?.monthlyMrr ?? 0,
      status: account?.unifiedStatus ?? teacherUnifiedStatus(null),
      studentCount: studentIdsByTeacher.get(teacherId)?.size ?? 0,
      groupCount: groupCountByTeacher.get(teacherId) ?? 0,
      createdAt: p.created_at ?? null,
      nextChargeCairoDay: account?.nextChargeCairoDay ?? null,
      isTest: !!p.is_test,
    });
  }

  // Test accounts last, then biggest earners, then by name.
  rows.sort((a, b) => {
    if (a.isTest !== b.isTest) return Number(a.isTest) - Number(b.isTest);
    if (b.monthlyMrr !== a.monthlyMrr) return b.monthlyMrr - a.monthlyMrr;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return rows;
}
