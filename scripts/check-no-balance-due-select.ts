/**
 * B2 regression guard: fail the build if any Supabase `.select(...)` names a
 * `balance_due` column on the students table (or anywhere — the column exists on NO
 * table).
 *
 * WHY: there is deliberately no persisted students.balance_due column. Selecting it makes
 * PostgREST 400 the WHOLE query, which surfaces as "student not found" for every student
 * (this exact gap caused the July 8 student-detail outage). Balances are computed live via
 * getStudentBalance (src/lib/studentBalance.ts) and must never be read from a column.
 *
 * SCOPE: `balance_due` is a legitimate DERIVED field name in many places (the scanner,
 * balance statements, the parent portal, revenue analytics) — an object property computed
 * FROM getStudentBalance, not a column select. Those are fine and must NOT trip this gate.
 * This guard flags ONLY `balance_due` appearing as a selected column, i.e.
 *   - inside a `.select('...')` / `.select("...")` / `.select(`...`)` argument,
 *   - inside a db-proxy `select: '...'` string,
 *   - inside a `const/let/var *SELECT* = '...'` column-list constant (e.g. STUDENT_SELECT).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', 'src');

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

// `balance_due` as a standalone COLUMN token: bounded by start/end, whitespace, comma,
// paren, or a quote. The char before `balance` in `chq_parent_balance_due` is `_` (a word
// char), so that substring never matches — only a real column reference does.
const COLUMN_TOKEN = /(?:^|[\s,('"`])balance_due(?:$|[\s,)'"`])/;

// A `.select(<string>)` or db-proxy `select: <string>` — captures the string body (group 2).
const SELECT_ARG = /(?:\.select\s*\(|\bselect\s*:)\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
// A `*SELECT*` column-list constant, e.g. `const STUDENT_SELECT = '...'` — body is group 3.
const SELECT_CONST = /\b(?:const|let|var)\s+\w*SELECT\w*\s*=\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gi;

const violations: string[] = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = file.replace(/\\/g, '/');

  SELECT_ARG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SELECT_ARG.exec(text)) !== null) {
    if (COLUMN_TOKEN.test(m[2])) violations.push(`${rel} — .select()/select: names balance_due`);
  }

  SELECT_CONST.lastIndex = 0;
  while ((m = SELECT_CONST.exec(text)) !== null) {
    if (COLUMN_TOKEN.test(m[2])) violations.push(`${rel} — *SELECT* constant names balance_due`);
  }
}

if (violations.length) {
  console.error(
    '[check-no-balance-due-select] students.balance_due does not exist — remove it from these selects:\n' +
      Array.from(new Set(violations)).join('\n'),
  );
  process.exit(1);
}
console.log('[check-no-balance-due-select] OK');
