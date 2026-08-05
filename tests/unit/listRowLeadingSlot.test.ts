/**
 * `ListRow` has ONE leading slot and three ways to fill it.
 *
 * `avatar` and `icon` arrived with the #340 primitive-adoption pass; `leading`
 * arrived with #351's `Merged-Center-Home` §01 schedule row, which puts a 52px
 * two-line start time in the same `.av` position. Both branches were green
 * against master on their own, and the collision only existed once both landed
 * — the naive merge rendered `leading` AND `icon` together whenever a caller
 * passed both, which is a row with two leading blocks and a shape the design
 * has no drawing for.
 *
 * This pins the resolution: exactly one block, in the order avatar > leading >
 * icon. There is no DOM environment in this suite (`vitest.config` sets
 * `environment: 'node'`), so this asserts on the source the same way
 * `payoutRequestAuthority.test.ts` does — which is also the only form that
 * catches the failure, since the bug is two *independent* JSX expressions
 * rather than a wrong rendered value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, 'src/components/patterns/ListRow.tsx'.split('/').join(sep)),
  'utf8',
);

describe('ListRow leading slot', () => {
  it('still offers all three ways to fill the slot', () => {
    expect(SRC).toContain('avatar?: string');
    expect(SRC).toContain('leading?: React.ReactNode');
    expect(SRC).toContain('icon?: LucideIcon');
  });

  it('renders the leading block from a SINGLE exclusive expression', () => {
    // The resolved form is one ternary chain: avatar ? ... : leading ? ... :
    // Icon ? ... : null. The broken form was a chain for avatar/leading plus a
    // SEPARATE `{!avatar && Icon && ...}` expression that could render on top
    // of it. Assert the separate expression is not back.
    expect(SRC).not.toMatch(/\{\s*!avatar\s*&&\s*Icon\s*&&/);
    expect(SRC).toMatch(/\)\s*:\s*leading\s*\?\s*\(/);
    expect(SRC).toMatch(/\)\s*:\s*Icon\s*\?\s*\(/);
  });

  it('gives avatar precedence over both others', () => {
    const avatarIdx = SRC.indexOf('{avatar ? (');
    const leadingIdx = SRC.indexOf(': leading ? (');
    const iconIdx = SRC.indexOf(': Icon ? (');
    expect(avatarIdx).toBeGreaterThan(-1);
    expect(leadingIdx).toBeGreaterThan(avatarIdx);
    expect(iconIdx).toBeGreaterThan(leadingIdx);
  });

  it('closes the chain with null rather than falling through', () => {
    // A chain ending in anything but an explicit null is how a fourth leading
    // block would get grafted on later without anyone noticing.
    const chainStart = SRC.indexOf('{avatar ? (');
    const chainEnd = SRC.indexOf(') : null}', chainStart);
    expect(chainEnd).toBeGreaterThan(chainStart);
  });
});
