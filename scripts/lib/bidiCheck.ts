/**
 * Pure, testable core of the `check:bidi` build gate.
 *
 * Catches mixed LTR-identifier-in-RTL rendering risks that are NOT isolated with
 * `<bdi>`. Under RTL (the Arabic-default UI) a `#` glued to a Latin/numeric value
 * visually reorders unless the value is wrapped in `<bdi>` (see docs/RTL.md).
 *
 * Two patterns are flagged on any `.tsx` line that does not contain `<bdi`:
 *   1. `#{ … }` — a `#` prefix immediately followed by a dynamic JSX expression
 *      (order numbers `#{shortId}`, indices `#{i + 1}`, student numbers, …).
 *   2. a `student_number` interpolation sitting next to `#` or `STU-` (legacy
 *      rule, kept for cases where the value is referenced by name).
 *
 * Previously the gate only had rule (2) keyed on the literal token
 * `student_number`, so real renders that pass a pre-extracted variable
 * (`#{shortId}`, `#{idLast8}`) slipped through and the gate "passed regardless".
 */
import fs from 'fs';
import path from 'path';

export function lineHasBidiViolation(line: string): boolean {
  // A line that isolates with <bdi> is already safe.
  if (line.includes('<bdi')) return false;
  // Pattern 1: `#` glued directly to a JSX expression `{`.
  if (/#\{/.test(line)) return true;
  // Pattern 2 (legacy): a student_number interpolation adjacent to #/STU-.
  if (
    line.includes('student_number') &&
    (line.includes('#') || line.includes('STU-')) &&
    /\{[^}]+\}/.test(line)
  ) {
    return true;
  }
  return false;
}

function walk(dir: string, acc: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.tsx')) acc.push(p);
  }
}

/** Scan a source root for unisolated mixed-identifier lines. Returns `file:line` strings. */
export function findBidiIssues(root: string): string[] {
  const files: string[] = [];
  walk(root, files);

  const issues: string[] = [];
  for (const file of files) {
    // PDF/print is physical-layout by design (RTL-EXEMPT) — skip.
    if (file.includes(`${path.sep}pdf${path.sep}`)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (lineHasBidiViolation(line)) {
        issues.push(`${file.replace(/\\/g, '/')}:${i + 1}`);
      }
    });
  }
  return issues;
}
