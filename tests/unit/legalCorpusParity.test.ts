import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DOC_ORDER,
  LEGAL_DOCS,
  LEGAL_CHROME,
  FORM_COPY,
  DONE_COPY,
  RELATIONSHIP_LABELS,
  REQUEST_TYPE_LABELS,
  RELATIONSHIPS,
  REQUEST_TYPES,
  type Bilingual,
  type LegalDocument,
} from '@/app/[locale]/legal/legalContent';

/**
 * `Merged-Public-Legal` §01 — corpus parity guard.
 *
 * The design file is the fixture. This reads
 * `design/Merged-Public-Legal.html` at test time and derives the four
 * documents' contents lists from the `.toc a` entries the design draws, then
 * asserts `legalContent.ts` carries the same sections, in the same order, in
 * both languages.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SNAPSHOT
 * ---------------------------------------------
 * Ten of the twenty-three sections have no drafted prose: the design lists them
 * in the contents but draws no body for them, because the wording is still with
 * Adsero (blocker X4). That fraction is the honest ceiling for this surface, and
 * it is the exact thing most likely to be silently "improved" later — by a pass
 * that invents PDPL commitments to fill the gaps, or by one that deletes the
 * empty sections so the file looks finished. A wrong legal sentence is binding
 * in a way a wrong number is not, so both directions are failures and both are
 * locked here:
 *
 *   - the SET of drafted sections must equal the set the design drafts, so no
 *     invented copy appears and no drafted copy goes missing;
 *   - the contents list must stay complete, so a pending section keeps its
 *     entry and its `#sN` anchor instead of being dropped.
 *
 * Deriving from the design rather than hard-coding the 13/23 split means the
 * test tracks the design when Adsero's text actually lands: add prose to
 * `legalContent.ts` and the corresponding design section together, and it
 * passes. Update only one, and it does not.
 */

const ROOT = process.cwd();
const DESIGN = readFileSync(join(ROOT, 'design', 'Merged-Public-Legal.html'), 'utf8');

/** Only the screen markup — never the CSS block or the how-to-read preamble. */
const SCREENS = DESIGN.slice(DESIGN.indexOf('<div class="mgd1 mgd-screen">'));

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/[‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "3 · Who controls your data" / "٣ · مين المتحكم" -> the title alone. */
function stripNumber(s: string): string {
  return s.replace(new RegExp(`^[0-9${AR_DIGITS}]+\\s*·\\s*`), '');
}

/**
 * Each reader frame is one `<div class="phone">…</div>`; frames alternate EN,
 * AR in document order, four documents after the two index frames.
 */
function readerFrames(): string[] {
  const out: string[] = [];
  const re = /<div class="phone">([\s\S]*?)<div class="cap">/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SCREENS)) !== null) out.push(m[1]);
  // Frames 0-1 are the index (no `.rhead`); the readers are the ones that have
  // both a version header and a contents card.
  return out.filter((f) => f.includes('class="rhead"') && f.includes('class="toc"'));
}

/** The `.toc a` entries of one frame, numbering stripped. */
function tocTitles(frame: string): string[] {
  const out: string[] = [];
  const re = /<a>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(frame)) !== null) out.push(stripNumber(decode(m[1])));
  return out;
}

/** The `.rsec` headings of one frame — the sections the design actually drafts. */
function draftedTitles(frame: string): string[] {
  const out: string[] = [];
  const re = /<div class="rsec">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(frame)) !== null) out.push(stripNumber(decode(m[1])));
  return out;
}

const FRAMES = readerFrames();

/** [en, ar] frame pair per document, in `DOC_ORDER`. */
const PAIRS = DOC_ORDER.map((slug, i) => ({
  slug,
  en: FRAMES[i * 2],
  ar: FRAMES[i * 2 + 1],
}));

describe('Merged-Public-Legal §01 — design fixture is readable', () => {
  it('finds exactly two reader frames per document', () => {
    expect(FRAMES).toHaveLength(DOC_ORDER.length * 2);
    for (const { en, ar } of PAIRS) {
      expect(en).toBeTruthy();
      expect(ar).toBeTruthy();
    }
  });

  it('pairs each frame with the right document by title', () => {
    for (const { slug, en, ar } of PAIRS) {
      const doc = LEGAL_DOCS[slug];
      const enTitle = decode(/<div class="rtitle">([\s\S]*?)<\/div>/.exec(en)?.[1] ?? '');
      const arTitle = decode(/<div class="rtitle">([\s\S]*?)<\/div>/.exec(ar)?.[1] ?? '');
      expect(enTitle).toBe(doc.title.en);
      expect(arTitle).toBe(doc.title.ar);
    }
  });
});

describe('Merged-Public-Legal §01 — contents lists match the design', () => {
  it.each(PAIRS)('$slug lists the design’s sections, in order, in both languages', ({
    slug,
    en,
    ar,
  }) => {
    const doc = LEGAL_DOCS[slug];
    expect(doc.sections.map((s) => s.title.en)).toEqual(tocTitles(en));
    expect(doc.sections.map((s) => s.title.ar)).toEqual(tocTitles(ar));
  });
});

describe('Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split', () => {
  it.each(PAIRS)('$slug drafts prose for exactly the sections the design drafts', ({
    slug,
    en,
  }) => {
    const doc = LEGAL_DOCS[slug];
    const live = doc.sections.filter((s) => s.blocks.length > 0).map((s) => s.title.en);
    expect(live).toEqual(draftedTitles(en));
  });

  it('leaves ten of the twenty-three sections pending, and no more', () => {
    const all = DOC_ORDER.flatMap((slug) => LEGAL_DOCS[slug].sections);
    const pending = all.filter((s) => s.blocks.length === 0);
    // Derived from the design in the per-document assertions above; restated as
    // a total so the blocker's size is visible in one line when it moves.
    const designPending = PAIRS.reduce(
      (n, { en }) => n + (tocTitles(en).length - draftedTitles(en).length),
      0,
    );
    expect(all).toHaveLength(23);
    expect(pending).toHaveLength(designPending);
    expect(pending).toHaveLength(10);
  });

  it('renders a pending section as an explicit line, never as invented copy', () => {
    expect(LEGAL_CHROME.pendingDraft.en).toBe('Pending Adsero draft.');
    expect(LEGAL_CHROME.pendingDraft.ar.length).toBeGreaterThan(0);
  });
});

describe('Merged-Public-Legal §01 — no half-translated string reaches a reader', () => {
  const tuples: [string, Bilingual][] = [];

  function collect(prefix: string, obj: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && 'en' in v && 'ar' in v) {
        tuples.push([`${prefix}.${k}`, v as Bilingual]);
      }
    }
  }

  collect('LEGAL_CHROME', LEGAL_CHROME);
  collect('FORM_COPY', FORM_COPY);
  collect('DONE_COPY', DONE_COPY);
  for (const r of RELATIONSHIPS) tuples.push([`relationship.${r}`, RELATIONSHIP_LABELS[r]]);
  for (const t of REQUEST_TYPES) tuples.push([`requestType.${t}`, REQUEST_TYPE_LABELS[t]]);
  for (const slug of DOC_ORDER) {
    const doc: LegalDocument = LEGAL_DOCS[slug];
    tuples.push([`${slug}.title`, doc.title]);
    doc.sections.forEach((s, i) => {
      tuples.push([`${slug}.s${i + 1}.title`, s.title]);
      s.blocks.forEach((b, j) => tuples.push([`${slug}.s${i + 1}.b${j + 1}`, b]));
    });
  }

  it('has both sides of every bilingual tuple filled', () => {
    const empty = tuples.filter(([, v]) => !v.en.trim() || !v.ar.trim()).map(([k]) => k);
    // `doc.meta` is deliberately excluded: an empty tuple there means "compute
    // the version line", which the index does. Everything else must be real.
    expect(empty).toEqual([]);
  });

  it('closes every `**bold**` marker it opens', () => {
    const unbalanced = tuples
      .flatMap(([k, v]) => [
        [k + '.en', v.en] as const,
        [k + '.ar', v.ar] as const,
      ])
      .filter(([, s]) => (s.split('**').length - 1) % 2 !== 0)
      .map(([k]) => k);
    expect(unbalanced).toEqual([]);
  });
});
