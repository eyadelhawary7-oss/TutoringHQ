/**
 * Two independent checks:
 *
 * 1. **Parity** — lists `process.env.<NAME>` references under `src/` and compares them to
 *    keys in `.env.example`. This is a *static* check. It proves a name is documented; it
 *    proves nothing about whether the variable is actually set anywhere.
 *
 * 2. **Fail-closed secret audit** (added 4 Aug 2026) — for the small set of secrets whose
 *    absence does not degrade a feature but *disables* one outright, checks the value in the
 *    current process environment for presence AND well-formedness. The parity check above
 *    passes happily for `CSRF_SECRET` because the name appears in both places, which is
 *    exactly why it never surfaced the risk: `.env.example` ships the literal placeholder
 *    `CSRF_SECRET=your-key-here`, which is not 64 hex characters, so a developer who copies
 *    `.env.example` verbatim gets a *malformed* secret and every mutation 403s with no clue
 *    why. Run this against a real environment (`vercel env pull`, then `npm run check:env`)
 *    before shipping anything that adds a `validateCSRFRequest` call.
 */
import fs from 'fs';
import path from 'path';

/**
 * Secrets that fail CLOSED: when missing or malformed the affected routes REJECT rather
 * than fall back. Each validator must mirror the runtime check in the module named below —
 * if they drift, this audit gives false assurance, which is worse than no audit.
 */
const CRITICAL_SECRETS: {
  name: string;
  source: string;
  validate: (v: string) => boolean;
  requirement: string;
  consequence: string;
}[] = [
  {
    name: 'CSRF_SECRET',
    source: 'src/lib/csrf.ts (isCSRFEnabled / getKey)',
    // Mirrors isCSRFEnabled(): exactly 64 hex chars (32 bytes) or CSRF cannot be enforced.
    validate: (v) => v.length === 64 && /^[0-9a-fA-F]+$/.test(v),
    requirement: 'exactly 64 hex characters (32 bytes)',
    consequence:
      'validateCSRFRequest() returns false and EVERY protected mutation returns 403 — in ' +
      'every environment, not just production. getKey() additionally throws when ' +
      "NODE_ENV === 'production'. This is fail-closed by design; do not weaken the check, " +
      'set the secret. Generate one with: openssl rand -hex 32',
  },
];

/** Returns the number of critical secrets that are missing or malformed. */
function auditCriticalSecrets(): number {
  const problems: string[] = [];

  for (const s of CRITICAL_SECRETS) {
    const value = process.env[s.name];
    if (!value) {
      problems.push(`${s.name} — NOT SET (required: ${s.requirement})`);
    } else if (!s.validate(value)) {
      problems.push(
        `${s.name} — SET BUT MALFORMED (${value.length} chars; required: ${s.requirement})`
      );
    }
  }

  if (problems.length === 0) {
    console.log('OK: all fail-closed secrets are present and well-formed.');
    return 0;
  }

  console.log('');
  console.log('FAIL-CLOSED SECRETS MISSING OR MALFORMED IN THIS ENVIRONMENT:');
  for (const p of problems) console.log(`  ${p}`);
  console.log('');
  for (const s of CRITICAL_SECRETS) {
    console.log(`  ${s.name} (enforced by ${s.source})`);
    console.log(`    If unset/malformed: ${s.consequence}`);
  }
  console.log('');
  console.log(
    '  NOTE: this reflects the environment this script is running in. It cannot see ' +
      'Vercel Production/Preview env vars unless you pulled them first (vercel env pull).'
  );

  return problems.length;
}

const SRC_ROOT = path.join(__dirname, '..', 'src');
const ENV_EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');
const ENV_REF_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const EXAMPLE_KEY_RE = /^([A-Z][A-Z0-9_]+)=/gm;

function collectTsFiles(dir: string, acc: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectTsFiles(p, acc);
    else if (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) acc.push(p);
  }
}

function extractEnvNamesFromSource(content: string): Set<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(ENV_REF_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (name) names.add(name);
  }
  return names;
}

function parseExampleKeys(content: string): Set<string> {
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(EXAMPLE_KEY_RE.source, EXAMPLE_KEY_RE.flags);
  while ((m = re.exec(content)) !== null) {
    const key = m[1];
    if (key) keys.add(key);
  }
  return keys;
}

function main(): void {
  if (!fs.existsSync(SRC_ROOT)) {
    console.error(`[check:env] Missing src directory: ${SRC_ROOT}`);
    process.exit(1);
  }

  const files: string[] = [];
  collectTsFiles(SRC_ROOT, files);

  const fromCode = new Set<string>();
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const n of extractEnvNamesFromSource(content)) fromCode.add(n);
  }

  let exampleKeys = new Set<string>();
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    const exampleContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    exampleKeys = parseExampleKeys(exampleContent);
  }

  const missingFromExample: string[] = [];
  for (const n of [...fromCode].sort()) {
    if (!exampleKeys.has(n)) missingFromExample.push(n);
  }

  const unusedInCode: string[] = [];
  for (const k of [...exampleKeys].sort()) {
    if (!fromCode.has(k)) unusedInCode.push(k);
  }

  // Run BOTH checks before exiting. The parity check used to `process.exit()` inline, which
  // would have hidden the secret audit behind an unrelated .env.example mismatch.
  let failed = false;

  if (missingFromExample.length > 0) {
    console.log('MISSING FROM .env.example:');
    for (const n of missingFromExample) console.log(n);
    failed = true;
  } else if (unusedInCode.length > 0) {
    console.log('WARNING: unused in code (safe to remove):');
    for (const n of unusedInCode) console.log(n);
  } else {
    console.log('OK: .env.example matches code references.');
  }

  if (auditCriticalSecrets() > 0) failed = true;

  process.exit(failed ? 1 : 0);
}

main();
