/**
 * Convert root-level string values in messages/*.json to empty objects so
 * nested keys (e.g. common.save) can be resolved. Excludes `locale`.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

for (const name of ['en.json', 'ar.json']) {
  const path = join(ROOT, 'messages', name);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && k !== 'locale') {
      console.log(`Converting ${name} root string key: ${k} = ${JSON.stringify(v).slice(0, 60)}${JSON.stringify(v).length > 60 ? '…' : ''} → {}`);
      data[k] = {};
      n++;
    }
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → ${n} keys converted in ${name}`);
}

console.log('\nType conflicts cleared. Run: node scripts/fill-i18n-missing.mjs');
