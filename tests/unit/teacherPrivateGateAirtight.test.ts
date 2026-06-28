import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PRIVATE_DIR = join(ROOT, 'src/app/api/teacher/private');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry === 'route.ts') out.push(p);
  }
  return out;
}

// The create-first-group route legitimately uses requireTeacherAuth for its POST
// (a brand-new teacher with no subscription row starts the trial) — but it carries
// its own explicit lapsed block (RESUBSCRIBE_REQUIRED). It is the ONLY exception.
const CREATE_GROUP_ROUTE = join(PRIVATE_DIR, 'groups/route.ts');

describe('AIRTIGHT: every teacher private-engine API route enforces the server gate', () => {
  const routes = walk(PRIVATE_DIR);

  it('found a meaningful number of private routes', () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it('every private route calls requireTeacherPrivateAccess (no UI-only gating)', () => {
    const missing = routes.filter((f) => !readFileSync(f, 'utf8').includes('requireTeacherPrivateAccess'));
    expect(missing, `routes missing requireTeacherPrivateAccess:\n${missing.join('\n')}`).toEqual([]);
  });

  it('no private route falls back to requireTeacherAuth — except the create-first-group route, which must block lapsed teachers', () => {
    const offenders: string[] = [];
    for (const f of routes) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('requireTeacherAuth')) continue;
      if (f === CREATE_GROUP_ROUTE) {
        // Allowed only with its explicit lapsed block.
        expect(src).toContain('RESUBSCRIBE_REQUIRED');
        continue;
      }
      offenders.push(f);
    }
    expect(offenders, `private routes still using requireTeacherAuth:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('AIRTIGHT: the RLS chokepoint is present in the committed schema snapshot', () => {
  const snap = readFileSync(join(ROOT, 'db/schema.snapshot'), 'utf8');

  it('defines is_teacher_private_locked()', () => {
    expect(snap).toContain('FUNCTION is_teacher_private_locked()');
  });

  it('gates owned private group writes on the lock predicate (not just suspended)', () => {
    const lines = snap.split('\n');
    for (const cmd of ['insert', 'update', 'delete']) {
      const line = lines.find((l) => l.startsWith(`POLICY student_groups.student_groups_teacher_${cmd} `));
      expect(line, `student_groups_teacher_${cmd} policy missing`).toBeTruthy();
      expect(line).toContain('is_teacher_private_locked');
    }
  });

  it('gates private-only direct-keyed tables on the lock predicate', () => {
    for (const needle of [
      'POLICY content_items.content_items_select',
      'POLICY student_group_notes.student_group_notes_teacher_select',
      'POLICY student_credits.student_credits_select',
    ]) {
      const line = snap.split('\n').find((l) => l.startsWith(needle));
      expect(line, `${needle} missing`).toBeTruthy();
      expect(line).toContain('is_teacher_private_locked');
    }
  });

  it('get_auth_teacher_group_ids() body changed from the pre-gate version', () => {
    // The pre-gate body md5 (recorded before this migration) must no longer appear.
    expect(snap).not.toContain('bodymd5=c896fd469149e30d87e8afc0adb4308b');
  });
});

describe('Honest free-baseline message (Option A): data safe, no deletion, no countdown', () => {
  const en = JSON.parse(readFileSync(join(ROOT, 'messages/en.json'), 'utf8'));
  const ar = JSON.parse(readFileSync(join(ROOT, 'messages/ar.json'), 'utf8'));

  function body(obj: Record<string, unknown>): string {
    // teacherPortal.pages.resubscribeLockedBody
    const pages = (obj.teacherPortal as Record<string, Record<string, string>> | undefined)?.pages;
    return pages?.resubscribeLockedBody ?? '';
  }

  it('English copy: data safe + return anytime, never claims deletion or a countdown', () => {
    const b = body(en).toLowerCase();
    expect(b).toContain('safe');
    expect(b).toContain('pick up');
    expect(b).not.toContain('will be deleted');
    expect(b).not.toContain('countdown');
    expect(b).not.toMatch(/days? left/);
  });

  it('Arabic copy: data safe (أمان), never claims it will be deleted (سيتم حذف)', () => {
    const b = body(ar);
    expect(b).toContain('أمان');
    expect(b).not.toContain('سيتم حذف');
    expect(b).not.toContain('سيُحذف');
  });
});
