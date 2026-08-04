/**
 * Lists process.env.<NAME> references under src/ and compares them to keys in .env.example.
 *
 * Also runs VALUE checks on the small set of variables where a syntactically
 * present but wrong value is a security problem rather than a config nit. Name
 * parity alone cannot see those: `SUPER_ADMIN_PHONES=placeholder` satisfies it
 * perfectly while granting super-admin to nobody. See scripts/lib/env-value-checks.ts
 * and S10 in design/BUILD-AFTER-REDESIGN.md.
 */
import fs from 'fs';
import path from 'path';
import { checkSuperAdminPhones, maskPhone, type EnvIssue } from './lib/env-value-checks';

const SRC_ROOT = path.join(__dirname, '..', 'src');
const ENV_EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');
const ENV_REF_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const EXAMPLE_KEY_RE = /^([A-Z][A-Z0-9_]+)=/gm;

/**
 * Keys that must be declared in .env.example whether or not `src/` still
 * references them. Without this, deleting the last `process.env.X` read also
 * silently deletes the requirement, and the parity check would report the
 * .env.example entry as "unused, safe to remove".
 *
 * SUPER_ADMIN_PHONES is here because it is an authority grant: it confers full
 * super-admin with no admin_users row behind it (S10).
 */
const REQUIRED_IN_EXAMPLE = ['SUPER_ADMIN_PHONES'] as const;

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

/**
 * Report on the values of the authority-bearing variables.
 *
 * NOTE ON WHERE THE VALUE COMES FROM: this script does not load .env files —
 * it never has, and adding a loader here would change what `npm run check:env`
 * means. It reads the ambient process env. So locally it will usually report
 * SUPER_ADMIN_PHONES as unset; the check has teeth where it matters, which is
 * anywhere the real environment is present (a Vercel shell, CI with the secret
 * injected, or `SUPER_ADMIN_PHONES=... npm run check:env` by hand).
 */
function checkEnvValues(): EnvIssue[] {
  const report = checkSuperAdminPhones(process.env.SUPER_ADMIN_PHONES);

  console.log('SUPER_ADMIN_PHONES:');
  if (report.unset) {
    console.log(
      report.notConfiguredReason === 'stock_placeholder'
        ? '  (still the stock .env.example value — not configured, nothing to validate)'
        : '  (not present in this environment — nothing to validate)',
    );
  } else {
    for (const e of report.entries) {
      console.log(
        e.valid
          ? `  ok      ${maskPhone(e.normalized)}`
          : `  INVALID "${e.raw}"`,
      );
    }
    // The count and fingerprint are the only handle anyone has on "extended by
    // one extra number": a phone appended to the list changes both, visibly,
    // in whatever log this ran in. Nothing in-app can see an env edit.
    console.log(`  grants: ${report.validCount}  fingerprint: ${report.fingerprint ?? 'n/a'}`);
  }

  return report.issues;
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

  const required = new Set<string>(REQUIRED_IN_EXAMPLE);

  const missingFromExample: string[] = [];
  for (const n of [...new Set([...fromCode, ...required])].sort()) {
    if (!exampleKeys.has(n)) missingFromExample.push(n);
  }

  const unusedInCode: string[] = [];
  for (const k of [...exampleKeys].sort()) {
    if (!fromCode.has(k) && !required.has(k)) unusedInCode.push(k);
  }

  // Every finding is printed before anything exits. The old shape returned on
  // the first category that had entries, so a value problem behind a naming
  // problem was invisible until the naming one was fixed.
  let failed = false;

  if (missingFromExample.length > 0) {
    console.log('MISSING FROM .env.example:');
    for (const n of missingFromExample) console.log(n);
    failed = true;
  }

  const valueIssues = checkEnvValues();
  const valueErrors = valueIssues.filter((i) => i.level === 'error');
  const valueWarnings = valueIssues.filter((i) => i.level === 'warning');

  if (valueErrors.length > 0) {
    console.log('INVALID ENV VALUES:');
    for (const i of valueErrors) console.log(i.message);
    failed = true;
  }

  if (valueWarnings.length > 0) {
    console.log('WARNING: env value notes:');
    for (const i of valueWarnings) console.log(i.message);
  }

  if (unusedInCode.length > 0) {
    console.log('WARNING: unused in code (safe to remove):');
    for (const n of unusedInCode) console.log(n);
  }

  if (failed) process.exit(1);

  if (unusedInCode.length === 0 && valueWarnings.length === 0) {
    console.log('OK: .env.example matches code references.');
  }
  process.exit(0);
}

main();
