import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  getSummerCopy,
  summerChipLabel,
  summerOfferTag,
  summerPopupFooter,
  type SummerPortal,
  type SummerLocale,
} from '@/lib/summer/copy';
import type { SummerBannerPhase } from '@/lib/summer/phase';

/**
 * Brand guard — the internal codename "CenterHQ" must never appear on any
 * rendered surface a human sees. Brand decision from Eyad: the public name is
 * "TutoringHQ" everywhere on screen, including internal staff and admin pages,
 * page titles, metadata, email bodies, and message copy.
 *
 * This guard is deliberately broad: it scans EVERY rendered surface, not just
 * customer-facing marketing copy —
 *   1. the two next-intl message catalogues (all UI strings flow through these),
 *   2. every string literal / JSX text in `src/**` (titles, metadata, headings,
 *      nav, badges, toasts, modals, email + WhatsApp copy, admin/staff chrome),
 *   3. the dynamically-built summer ribbon/popup copy at runtime.
 *
 * It fails if the exact codename "CenterHQ" appears in any of those, while
 * still allowing the hidden internal identifiers that are never displayed:
 *   - the auth email suffix `@centerhq.local` (the login identity, never shown),
 *   - the production host `centerhq.app`,
 *   - code comments, `console.*` logs, and internal variable/token names.
 *
 * The scan is case-sensitive on the codename "CenterHQ", so lowercase hostnames
 * (`centerhq.local`, `centerhq.app`) and lowercase identifiers (`colCenterhq`)
 * are inherently allowed; the explicit allow-list below documents intent and
 * guards against a future case-insensitive tightening.
 */

const CODENAME = 'CenterHQ';
const ROOT = process.cwd();

/** Lowercase internal hostnames that legitimately embed the old name — never rendered as brand copy. */
const ALLOWED_INTERNAL = ['centerhq.local', 'centerhq.app'];

// ── source-tree scanner ────────────────────────────────────────────────────

const SRC = join(ROOT, 'src');
const SCANNED_EXT = /\.(ts|tsx|css)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCANNED_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Blank out `/* ... *\/` block comments (JSDoc, CSS, JSX `{/* *\/}`) while keeping line numbers stable. */
function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

/**
 * Classify a single occurrence of the codename on a (block-comment-stripped)
 * line. Returns true when the occurrence is a rendered string literal or JSX
 * text (a violation), false when it sits in an allowed context (line comment,
 * console log, or internal hostname).
 */
function isRenderedOccurrence(strippedLine: string): boolean {
  const idx = strippedLine.indexOf(CODENAME);
  if (idx === -1) return false; // was inside a block comment → allowed

  // Line comment: `//` appearing before the codename on the same line.
  const commentIdx = strippedLine.indexOf('//');
  if (commentIdx !== -1 && commentIdx < idx) return false;

  // Diagnostic logging is internal, never a rendered surface.
  if (strippedLine.includes('console.')) return false;

  // Internal hostnames (case-sensitive codename won't match these, but be explicit).
  if (ALLOWED_INTERNAL.some((t) => strippedLine.includes(t))) return false;

  return true;
}

/** Scan one file's content: block comments removed, then each line classified. */
function scanContent(raw: string, file: string): Violation[] {
  const violations: Violation[] = [];
  if (!raw.includes(CODENAME)) return violations;
  const lines = stripBlockComments(raw).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(CODENAME)) continue;
    if (isRenderedOccurrence(lines[i])) {
      violations.push({ file, line: i + 1, text: lines[i].trim() });
    }
  }
  return violations;
}

function scanSource(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walk(SRC)) {
    violations.push(...scanContent(readFileSync(file, 'utf8'), relative(ROOT, file)));
  }
  return violations;
}

describe('brand guard: "CenterHQ" never appears on a rendered surface', () => {
  it('no rendered string literal or JSX text in src/** contains the codename', () => {
    const violations = scanSource();
    const report = violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join('\n');
    expect(violations, `Rendered "CenterHQ" found — use "TutoringHQ":\n${report}`).toEqual([]);
  });

  it.each(['messages/en.json', 'messages/ar.json'])(
    '%s (every UI string) contains no CenterHQ',
    (rel) => {
      const body = readFileSync(join(ROOT, rel), 'utf8');
      expect(body).not.toContain(CODENAME);
    },
  );

  it('dynamically-built summer ribbon + popup copy uses TutoringHQ, never CenterHQ', () => {
    const opts = { floorLabel: 'Aug 30', trialDays: 14 };
    const portals: SummerPortal[] = ['combined', 'centers', 'teachers'];
    const phases: SummerBannerPhase[] = ['phase1', 'phase2'];
    const locales: SummerLocale[] = ['en', 'ar'];
    for (const portal of portals) {
      for (const phase of phases) {
        for (const loc of locales) {
          const c = getSummerCopy(portal, phase, loc, opts);
          const blob = [
            c.ribbon,
            c.ribbonSub,
            c.ribbonCta,
            c.popupTitle,
            c.popupBody,
            c.countdownLabel,
            c.popupCta,
            summerChipLabel(loc),
            summerOfferTag(loc),
            summerPopupFooter(loc, opts.floorLabel),
          ].join(' ');
          expect(blob).not.toContain(CODENAME);
        }
      }
    }
  });

  // Self-test: prove the scanner actually has teeth (catches rendered copy) and
  // the allow-list is precise (leaves comments, JSDoc, logs, and hosts alone).
  it('scanner flags rendered copy', () => {
    expect(scanContent(`const meta = { title: 'CenterHQ · Admin' };\n`, 'x.tsx')).toHaveLength(1);
    expect(scanContent(`  return <span>Welcome to CenterHQ</span>;\n`, 'x.tsx')).toHaveLength(1);
    expect(scanContent(`export const brand = 'CenterHQ';\n`, 'x.ts')).toHaveLength(1);
  });

  it('scanner allows line comments, JSDoc block comments, logs, and internal hosts', () => {
    expect(scanContent(`  // CenterHQ stores groups in student_groups\n`, 'x.ts')).toEqual([]);
    expect(scanContent(`/**\n * CenterHQ column is emphasised\n */\n`, 'x.ts')).toEqual([]);
    expect(scanContent(`  foo(); // takes no cut for CenterHQ\n`, 'x.ts')).toEqual([]);
    expect(scanContent(`    console.error('[CenterHQ Error]', err);\n`, 'x.ts')).toEqual([]);
    expect(scanContent(`  const email = digits + '@centerhq.local';\n`, 'x.ts')).toEqual([]);
  });
});
