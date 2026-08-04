/**
 * Lists process.env.<NAME> references under src/ and compares them to keys in .env.example.
 *
 * Also reports NAMED CONFIG SURFACES that are declared but still holding
 * placeholders. Key-vs-code parity alone cannot catch that: a surface whose keys
 * are all present in .env.example and all read by src/ passes the parity check
 * while every value is the literal string "placeholder". For a feature that is
 * built-but-not-contracted, that is exactly the state we need to be able to see.
 */
import fs from 'fs';
import path from 'path';
// Imported, not re-implemented. The guard and this script MUST agree exactly on
// what "still a placeholder" means — two divergent definitions would let a
// credential count as live to one and dead to the other, which is the confusion
// this whole report exists to prevent. valifyConfig.ts has no imports of its
// own, so pulling it into a plain tsx script is safe.
import { VALIFY_ENV_KEYS, isPlaceholderValue } from '../src/lib/valifyConfig';
import { ENV_KEYS as COLLECTION_PAYOUT_ENV_KEYS } from '../src/lib/collectionPayout/config';

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

/**
 * Named config surfaces whose values are checked for placeholder-ness, not just
 * for presence. Add a surface here when a feature is built against credentials
 * that do not exist yet, so its dormancy is VISIBLE rather than assumed.
 */
interface ConfigSurface {
  name: string;
  /** Every key the surface owns. */
  keys: readonly string[];
  /** The subset without which the feature cannot run at all. */
  required: readonly string[];
}

const CONFIG_SURFACES: readonly ConfigSurface[] = [
  {
    name: 'Valify (identity verification / e-KYC) — src/lib/valifyConfig.ts',
    keys: VALIFY_ENV_KEYS,
    required: ['VALIFY_API_KEY', 'VALIFY_BASE_URL', 'VALIFY_WEBHOOK_SECRET'],
  },
  {
    // A SECOND named surface, and the fact that there are two is a live open
    // question for Eyad rather than an oversight — see
    // design/PHASE4-CONSOLIDATION-NOTES.md §4. Different vendor (Paymob
    // Payouts, not Valify), disjoint credentials, and neither module reads the
    // other's keys. Listing both here is what makes "there are two" visible on
    // every run instead of discoverable by grep.
    name: 'Paymob Payouts (payout rail) — src/lib/collectionPayout/config.ts',
    keys: Object.values(COLLECTION_PAYOUT_ENV_KEYS),
    required: [
      COLLECTION_PAYOUT_ENV_KEYS.railBaseUrl,
      COLLECTION_PAYOUT_ENV_KEYS.railClientId,
      COLLECTION_PAYOUT_ENV_KEYS.railClientSecret,
      COLLECTION_PAYOUT_ENV_KEYS.railUsername,
      COLLECTION_PAYOUT_ENV_KEYS.railPassword,
      COLLECTION_PAYOUT_ENV_KEYS.railCallbackHmacSecret,
    ],
  },
];

/**
 * Report which named surfaces are live and which are still placeholders.
 *
 * Deliberately NON-FATAL. A placeholder is the CORRECT state for Valify today —
 * no contract exists — so exiting non-zero would fail every local run and every
 * CI job for a condition that is intended. The report makes the dormancy
 * legible; it does not pretend it is a fault.
 */
function reportConfigSurfaces(): void {
  for (const surface of CONFIG_SURFACES) {
    const missingRequired = surface.required.filter((k) => isPlaceholderValue(process.env[k]));
    const placeholderAll = surface.keys.filter((k) => isPlaceholderValue(process.env[k]));

    if (missingRequired.length === 0) {
      console.log(`[check:env] CONFIGURED: ${surface.name}`);
      continue;
    }

    console.log(`[check:env] NOT CONFIGURED: ${surface.name}`);
    console.log(`             required, absent or placeholder: ${missingRequired.join(', ')}`);
    const optional = placeholderAll.filter((k) => !missingRequired.includes(k));
    if (optional.length > 0) {
      console.log(`             optional, absent or placeholder: ${optional.join(', ')}`);
    }
    console.log(
      '             Every dependent entry point refuses with a named cause. Nothing reports success.',
    );
  }
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

  // Printed BEFORE any exit. The parity check below already fails on this repo
  // for six pre-existing keys, so a report that ran only on the success path
  // would never run at all — which would defeat the point of adding it.
  reportConfigSurfaces();

  if (missingFromExample.length > 0) {
    console.log('MISSING FROM .env.example:');
    for (const n of missingFromExample) console.log(n);
    process.exit(1);
  }

  if (unusedInCode.length > 0) {
    console.log('WARNING: unused in code (safe to remove):');
    for (const n of unusedInCode) console.log(n);
    process.exit(0);
  }

  console.log('OK: .env.example matches code references.');
  process.exit(0);
}

main();
