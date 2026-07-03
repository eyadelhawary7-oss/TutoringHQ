import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Safety net for the centerhq.app → tutoringhq.app domain cutover: production
// once shipped welcome/invite links pointing at the retired domain because the
// configured public URL (and several code fallbacks) still said centerhq.app.
// This test fails if that regresses - either via environment configuration or
// via a fallback literal creeping back into src/.

const RETIRED_DOMAIN = 'centerhq.app';

// The middleware CORS allowlist deliberately keeps the legacy origins during
// the cutover (documented in src/proxy.ts) - the only permitted mention.
const ALLOWED_FILES = new Set(['src/proxy.ts']);

function collectSourceFiles(dir: string, acc: string[]): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectSourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

describe('retired domain safety net', () => {
  it('the configured public URL is not the retired centerhq.app domain', () => {
    for (const key of ['NEXT_PUBLIC_APP_URL', 'APP_URL'] as const) {
      const value = process.env[key];
      if (value) {
        expect(value, `${key} points at the retired domain`).not.toContain(RETIRED_DOMAIN);
      }
    }
  });

  it('no src/ file falls back to the retired domain (proxy CORS allowlist excepted)', () => {
    const root = path.join(__dirname, '..', '..');
    const srcRoot = path.join(root, 'src');
    const offenders: string[] = [];

    for (const file of collectSourceFiles(srcRoot, [])) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(RETIRED_DOMAIN)) offenders.push(rel);
    }

    expect(offenders, `retired domain referenced in: ${offenders.join(', ')}`).toEqual([]);
  });
});
