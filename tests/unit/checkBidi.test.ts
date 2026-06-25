import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { lineHasBidiViolation, findBidiIssues } from '../../scripts/lib/bidiCheck';

describe('check-bidi gate matcher', () => {
  it('flags an unisolated `#{…}` mixed identifier', () => {
    expect(lineHasBidiViolation('<span>#{shortId}</span>')).toBe(true);
    expect(lineHasBidiViolation('<div>#{i + 1} {name}</div>')).toBe(true);
    expect(lineHasBidiViolation('#{o.id.slice(-8).toUpperCase()}')).toBe(true);
  });

  it('flags a student_number interpolation next to # / STU-', () => {
    expect(lineHasBidiViolation('<span>STU-{student.student_number}</span>')).toBe(true);
  });

  it('passes when the identifier is isolated with <bdi>', () => {
    expect(lineHasBidiViolation('<bdi>#{shortId}</bdi>')).toBe(false);
    expect(lineHasBidiViolation('<bdi>#{i + 1}</bdi> {name}')).toBe(false);
  });

  it('does not flag plain text or non-`#{` lines', () => {
    expect(lineHasBidiViolation('<span>{name}</span>')).toBe(false);
    expect(lineHasBidiViolation('const x = `${y}`;')).toBe(false);
    expect(lineHasBidiViolation('// a comment about #ids')).toBe(false);
  });
});

describe('check-bidi gate over a source tree', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bidi-gate-'));
    fs.writeFileSync(
      path.join(root, 'good.tsx'),
      'export const Good = () => <span><bdi>#{shortId}</bdi></span>;\n',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('passes a clean tree (gate would exit 0)', () => {
    expect(findBidiIssues(root)).toHaveLength(0);
  });

  it('FAILS on a planted bidi violation (gate would exit 1)', () => {
    const bad = path.join(root, 'bad.tsx');
    fs.writeFileSync(bad, 'export const Bad = () => <span>#{shortId}</span>;\n');
    try {
      const issues = findBidiIssues(root);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.endsWith('bad.tsx:1'))).toBe(true);
    } finally {
      fs.rmSync(bad, { force: true });
    }
  });
});
