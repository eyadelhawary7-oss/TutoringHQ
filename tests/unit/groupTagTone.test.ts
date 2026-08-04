import { describe, expect, it } from 'vitest';
import {
  GROUP_TAG_TONE_COUNT,
  groupTagTone,
} from '../../src/lib/groupTagTone';

/**
 * Merged-Teacher-Students §01/§02 group tag tint.
 *
 * The one property that actually matters is STABILITY: the roster (§01, which
 * sees every group the teacher runs) and the student detail page (§02, which
 * sees only the groups one student is in) must paint the same group the same
 * colour. That rules out any index-based assignment, so these tests pin the
 * hash's behaviour rather than its specific output values.
 */
describe('groupTagTone', () => {
  const ID_A = '2a1f4c6e-0b3d-4f18-9c72-5e8a1d4b7c90';
  const ID_B = '7d9e0b21-63c4-4a5f-8e10-cc3b2f96a145';

  it('returns the same tone for the same id every time', () => {
    const first = groupTagTone(ID_A);
    for (let i = 0; i < 50; i += 1) {
      expect(groupTagTone(ID_A)).toBe(first);
    }
  });

  it('does not depend on the order or company the id is seen in', () => {
    // §01 resolves the tone from the teacher's full group list, §02 from the
    // one or two groups a student is enrolled in. Same id, same tone.
    const rosterView = [ID_A, ID_B, 'f0c8...'].map(groupTagTone);
    const detailView = [ID_B].map(groupTagTone);
    expect(detailView[0]).toBe(rosterView[1]);
  });

  it('only ever emits one of the design\'s two tag tints', () => {
    const mint = 'bg-[var(--color-mint)] text-[var(--color-teal-deep)]';
    const brass = 'bg-[var(--color-sand)] text-[var(--color-brass)]';
    for (let i = 0; i < 200; i += 1) {
      expect([mint, brass]).toContain(groupTagTone(`group-${i}`));
    }
  });

  it('actually uses both tones across a realistic group set', () => {
    const tones = new Set(
      Array.from({ length: 40 }, (_, i) => groupTagTone(`group-${i}`)),
    );
    expect(tones.size).toBe(GROUP_TAG_TONE_COUNT);
  });

  it('handles a null or empty id without throwing', () => {
    expect(groupTagTone(null)).toBe(groupTagTone(''));
    expect(groupTagTone(undefined)).toBe(groupTagTone(''));
    expect(typeof groupTagTone(null)).toBe('string');
  });
});
