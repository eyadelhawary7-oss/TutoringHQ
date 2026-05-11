/**
 * Lists process.env.<NAME> references under src/ and compares them to keys in .env.example.
 */
import fs from 'fs';
import path from 'path';

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
