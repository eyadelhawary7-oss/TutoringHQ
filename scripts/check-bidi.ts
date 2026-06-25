/**
 * `check:bidi` build gate — fails the build on unisolated mixed-script
 * identifiers (Prompt 7 PART B4). Matching logic lives in ./lib/bidiCheck so it
 * can be unit-tested. The scan root defaults to `src/` but can be overridden
 * with BIDI_CHECK_ROOT (used by the gate's own test to point at a fixture).
 */
import path from 'path';
import { findBidiIssues } from './lib/bidiCheck';

const ROOT = process.env.BIDI_CHECK_ROOT ?? path.join(__dirname, '..', 'src');

const issues = findBidiIssues(ROOT);
if (issues.length) {
  console.error('[check-bidi] Wrap mixed identifiers in <bdi>:\n' + issues.join('\n'));
  process.exit(1);
}
console.log('[check-bidi] OK');
