/**
 * Flags obvious mixed-script risks: `#` + dynamic `{student_number}` without `<bdi>` on the same line (Prompt 7 PART B4).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', 'src');

function walk(dir: string, acc: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.tsx')) acc.push(p);
  }
}

const files: string[] = [];
walk(ROOT, files);

const issues: string[] = [];
for (const file of files) {
  if (file.includes(`${path.sep}pdf${path.sep}`)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('<bdi')) return;
    if (
      line.includes('student_number') &&
      (line.includes('#') || line.includes('STU-')) &&
      /\{[^}]+\}/.test(line)
    ) {
      issues.push(`${file.replace(/\\/g, '/')}:${i + 1}`);
    }
  });
}

if (issues.length) {
  console.error('[check-bidi] Wrap mixed identifiers:\n' + issues.join('\n'));
  process.exit(1);
}
console.log('[check-bidi] OK');
