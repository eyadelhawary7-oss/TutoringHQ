/**
 * Block raw Number.prototype.toLocaleString outside locale helpers (Prompt 7 PART B5).
 * Allowed: src/lib/formatNumber.ts (central Intl wrapper).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', 'src');
const ALLOW = new Set([path.normalize(path.join(ROOT, 'lib', 'formatNumber.ts'))]);

function walk(dir: string, acc: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      walk(p, acc);
    } else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) acc.push(p);
  }
}

const files: string[] = [];
walk(ROOT, files);

const violations: string[] = [];
for (const file of files) {
  if (ALLOW.has(path.normalize(file))) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (/\.toLocaleString\s*\(/.test(text)) {
    violations.push(file.replace(/\\/g, '/'));
  }
}

if (violations.length) {
  console.error('[check-no-tolocalestring] Forbidden .toLocaleString in:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('[check-no-tolocalestring] OK');
