import { Fragment, type ReactNode } from 'react';

/**
 * Inline renderer for the legal copy in `legalContent.ts`.
 *
 * Two jobs, both deliberately small — this is legal text, so it renders as React
 * nodes and never through `dangerouslySetInnerHTML`:
 *
 *  1. `**bold**` becomes `<b>`, matching the design's `.rp b` (which is just
 *     `color: var(--color-ink)` against the lighter body colour).
 *  2. Under Arabic, runs of Latin letters/digits (TutoringHQ, Paymob, PostHog,
 *     Sentry, Adsero, Solo, Enterprise, Standard, Pro, Scale) are wrapped in
 *     `<bdi>`. The `check:bidi` gate only flags `#{…}` and `student_number`
 *     patterns so it would not catch these, but `docs/RTL.md` is right that an
 *     un-isolated Latin run reorders against adjacent Arabic punctuation — the
 *     trailing comma in "TutoringHQ بيعالجها بس، …" is exactly the case.
 */

/** A Latin run: at least one ASCII letter, plus adjoining digits/@._- */
const LATIN_RUN = /[A-Za-z][A-Za-z0-9@._-]*/g;

/** Wrap Latin runs in <bdi> so they do not reorder inside RTL text. */
function isolateLatin(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LATIN_RUN.lastIndex = 0;
  let i = 0;
  while ((m = LATIN_RUN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<bdi key={`${keyPrefix}-b${i}`}>{m[0]}</bdi>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderPlain(text: string, isAr: boolean, keyPrefix: string): ReactNode {
  if (!isAr) return text;
  return <Fragment key={keyPrefix}>{isolateLatin(text, keyPrefix)}</Fragment>;
}

/**
 * Parse `**bold**` segments into React nodes. Odd-indexed split parts are the
 * bold ones because `split` on a paired delimiter alternates.
 */
export function renderInline(text: string, isAr: boolean): ReactNode {
  const parts = text.split('**');
  return parts.map((part, i) => {
    if (!part) return null;
    const key = `p${i}`;
    const inner = renderPlain(part, isAr, key);
    return i % 2 === 1 ? (
      <b key={key} className="font-bold text-[var(--color-ink)]">
        {inner}
      </b>
    ) : (
      <Fragment key={key}>{inner}</Fragment>
    );
  });
}
