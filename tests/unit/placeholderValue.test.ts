import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { isPlaceholderValue } from '@/lib/placeholderValue';
import { isPlaceholderValue as fromValifyConfig } from '@/lib/valifyConfig';
import { isPlaceholderValue as fromCollectionPayoutConfig } from '@/lib/collectionPayout/config';

/**
 * There must be exactly ONE answer to "has a human filled this value in yet?".
 *
 * Phase 4 shipped two, with different vocabularies, and asserted in shipped text
 * that there was one. Because scripts/check-env.ts judged the payout-rail keys
 * with the Valify dialect while the module gating /api/webhooks/payout-provider
 * judged the SAME keys with its own, a secret could read "not configured" to an
 * operator and "live" to the code. These tests exist so that cannot come back.
 */

const SRC_ROOT = path.join(__dirname, '..', '..', 'src');

function walk(dir: string, acc: string[]): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

describe('there is exactly one placeholder vocabulary', () => {
  it('only src/lib/placeholderValue.ts DEFINES isPlaceholderValue', () => {
    // Matches a definition (`function isPlaceholderValue`, `const isPlaceholderValue =`),
    // never a re-export or an import, so the two config points may keep
    // forwarding the shared one.
    const defRe = /(?:export\s+)?(?:async\s+)?function\s+isPlaceholderValue\b|(?:const|let|var)\s+isPlaceholderValue\s*[:=]/;
    const definers = walk(SRC_ROOT, [])
      .filter((f) => defRe.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC_ROOT, f));

    expect(definers).toEqual(['lib/placeholderValue.ts']);
  });

  it('both config points forward the identical function object', () => {
    // Not merely "behaves the same today" — the same reference, so they cannot
    // drift apart without this failing.
    expect(fromValifyConfig).toBe(isPlaceholderValue);
    expect(fromCollectionPayoutConfig).toBe(isPlaceholderValue);
  });
});

describe('the vocabulary is the UNION of the two dialects that were merged', () => {
  it('keeps the tokens only the Valify dialect caught', () => {
    // The payout dialect returned false for both of these. Losing them would
    // widen what counts as a live credential on the identity rail.
    expect(isPlaceholderValue('test')).toBe(true);
    expect(isPlaceholderValue('<your-url>')).toBe(true);
    expect(isPlaceholderValue('<secret>')).toBe(true);
  });

  it('keeps the tokens only the payout dialect caught', () => {
    // The Valify dialect returned false for both of these — its 'replace-me'
    // substring does not match the underscore spelling. Losing them would widen
    // what counts as a live credential on the MONEY rail.
    expect(isPlaceholderValue('not-configured')).toBe(true);
    expect(isPlaceholderValue('not_configured')).toBe(true);
    expect(isPlaceholderValue('replace_me')).toBe(true);
    expect(isPlaceholderValue('replace-me')).toBe(true);
  });

  it('is absent-and-blank safe', () => {
    for (const v of [undefined, null, '', '   ']) {
      expect(isPlaceholderValue(v as string | undefined)).toBe(true);
    }
  });

  it('recognises every dialect that actually ships in .env.example', () => {
    for (const v of [
      'placeholder',
      'PLACEHOLDER',
      'PLACEHOLDER_NOT_CONFIGURED',
      'your-key-here',
      'Your-Key-Here',
      'changeme',
      ' TODO ',
      'tbd',
      'https://example.com',
    ]) {
      expect(isPlaceholderValue(v), `${JSON.stringify(v)} should be a placeholder`).toBe(true);
    }
  });

  it('does not swallow a real credential', () => {
    for (const v of [
      'vk_live_8f3a91c2b7e04d5a9f1c6e2b8d4a7c30',
      'https://verify.valifysolutions.com',
      'https://payouts.paymobsolutions.com/api/secure/',
      'https://stagingpayouts.paymobsolutions.com/api/secure/',
      'sk_live_9',
      'x',
    ]) {
      expect(isPlaceholderValue(v), `${JSON.stringify(v)} should NOT be a placeholder`).toBe(false);
    }
  });
});

describe('the specific divergence that made this a security bug', () => {
  it('judges the payout callback HMAC secret the same way for every reader', () => {
    // scripts/check-env.ts and src/lib/collectionPayout/config.ts both gate
    // COLLECTION_PAYOUT_RAIL_CALLBACK_HMAC_SECRET. When they disagreed, `test`
    // printed NOT CONFIGURED to the operator while the webhook accepted
    // callbacks signed with it (attack A1).
    for (const secret of ['test', '<secret>', 'placeholder', 'not-configured']) {
      expect(fromValifyConfig(secret)).toBe(true);
      expect(fromCollectionPayoutConfig(secret)).toBe(true);
    }
  });
});
