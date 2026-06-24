// src/lib/teacherPrivateView.ts
//
// Decides what a teacher sees in the PRIVATE-ENGINE area. The free zone (center
// monitoring) is never affected by this — it is always available.
//
// When a teacher's private engine lapses (failed/overdue payment, past the
// single-day lock) she takes a FULL DROP to the free tier — exactly as if she
// were a never-subscribed teacher — EXCEPT the private surfaces show a
// "resubscribe to get your saved data back" message instead of the trial upsell.
// Her private data is preserved in the DB (never deleted); resubscribing restores
// access to everything as it was.
//
//   hasPrivateAccess (teacher_private_access RPC) true  -> 'records'
//   locked but previously subscribed (state 'lapsed')   -> 'resubscribe'
//   never subscribed (state 'center_only')              -> 'upsell'
//
// NOTE: teachers deliberately differ from centers here. A locked CENTER keeps a
// summary lock screen (headline numbers + pay). A lapsed TEACHER does NOT — she
// drops to the free tier with a resubscribe message, no headline-numbers view.

export type TeacherPortalState = 'center_only' | 'unified' | 'lapsed';
export type TeacherPrivateView = 'records' | 'resubscribe' | 'upsell';

export function resolveTeacherPrivateView(opts: {
  hasPrivateAccess: boolean;
  state: TeacherPortalState;
}): TeacherPrivateView {
  if (opts.hasPrivateAccess) return 'records';
  return opts.state === 'lapsed' ? 'resubscribe' : 'upsell';
}

/**
 * True when the paid private engine is gated (records hidden) — i.e. the teacher
 * is on the free tier. Both 'resubscribe' (lapsed) and 'upsell' (never subscribed)
 * are gated; only 'records' opens the private records.
 */
export function isTeacherPrivateGated(view: TeacherPrivateView): boolean {
  return view !== 'records';
}
