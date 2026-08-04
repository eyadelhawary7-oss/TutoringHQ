// src/lib/placeholderValue.ts
//
// ██ THE ONE PLACEHOLDER VOCABULARY. ██
//
// A value is a "placeholder" when a human has not filled it in yet. Deciding
// that is not a per-vendor question, and it must not be answered twice.
//
// WHY THIS MODULE EXISTS. Phase 4 shipped two config points — src/lib/
// valifyConfig.ts for the identity vendor and src/lib/collectionPayout/
// config.ts for the payout rail — and each carried its own isPlaceholderValue
// with a DIFFERENT vocabulary. That is tolerable only if nothing ever judges
// the same key with both, and something did: scripts/check-env.ts imported the
// Valify one and applied it to the COLLECTION_PAYOUT_RAIL_* keys, while the
// module that actually gates /api/webhooks/payout-provider applied its own to
// the identical keys. The two disagreed on 13 of 15 tokens. Concretely, with
// COLLECTION_PAYOUT_RAIL_CALLBACK_HMAC_SECRET=test, `npm run check:env` printed
// NOT CONFIGURED — an operator reads that as "the webhook is closed" — while
// the gate read the secret as live and the webhook stopped 503-ing and began
// accepting callbacks HMAC'd with a guessable secret. That is attack A1 in
// .env.example, reached through a disagreement about vocabulary rather than
// through any missing check.
//
// So: one vocabulary, imported by both config points and by check-env.ts.
// Having TWO CONFIG POINTS (one per vendor) remains a live open question for
// Eyad — see design/PHASE4-CONSOLIDATION-NOTES.md §4 — but having two ANSWERS
// to "is this filled in?" is not a question, it is a defect, and it is closed
// here.
//
// THE VOCABULARY IS THE UNION OF BOTH, NOT EITHER ONE. Neither original was a
// superset. The Valify list caught `test` and any value containing `<`, which
// the payout list did not; the payout list caught `not-configured` and
// `replace_me`, which the Valify list did not. Taking either alone would have
// silently WIDENED what counts as a live credential on one of the two rails.
// Every token below is therefore load-bearing, and tests/unit/
// placeholderValue.test.ts pins the four that distinguished the two dialects.
//
// BIAS: when in doubt, call it a placeholder. A false positive costs one
// puzzled operator who has to pick a less silly-looking secret. A false
// negative means a money or identity path treats a slot as a credential, which
// is the exact "green checkmark backed by no integration" failure Phase 4 must
// not have.
//
// This module deliberately has NO IMPORTS, so a plain `tsx` script
// (scripts/check-env.ts) can pull it in without dragging a runtime behind it.

/** Whole values that mean "nobody has filled this in". Case-insensitive. */
const PLACEHOLDER_EXACT: ReadonlySet<string> = new Set([
  'placeholder',
  'your-key-here',
  'your-key',
  'changeme',
  'change-me',
  'todo',
  'tbd',
  'none',
  'null',
  'undefined',
  'xxx',
  'example',
  'test',
  'unset',
]);

/** Substrings that mark a value as a slot rather than a secret. */
const PLACEHOLDER_SUBSTRINGS: readonly string[] = [
  'placeholder',
  'your-key',
  'your-api',
  'your-secret',
  'changeme',
  'change-me',
  'replace-me',
  'example.com',
  '<',
];

/**
 * Shapes the exact set and the substring list both miss. Kept as patterns
 * rather than folded into the exact set because each covers a small family of
 * separator spellings (`not_configured`, `not configured`, `replace me`).
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^not[-_ ]?configured$/i,
  /^replace[-_ ]?me$/i,
];

/**
 * True when `value` is absent, blank, or one of the repo's placeholder tokens.
 *
 * This is the ONLY implementation in the codebase. Both config points and
 * scripts/check-env.ts import it, so a credential cannot be live to one reader
 * and dead to another.
 */
export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (value == null) return true;
  const t = String(value).trim();
  if (t.length === 0) return true;
  const lower = t.toLowerCase();
  if (PLACEHOLDER_EXACT.has(lower)) return true;
  if (PLACEHOLDER_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}
