'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatNumber } from '@/lib/formatNumber';
import LegalChrome from '../LegalChrome';
import { renderInline } from '../richText';
import {
  DONE_COPY,
  FORM_COPY,
  LEGAL_CHROME,
  RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  REQUEST_TYPES,
  REQUEST_TYPE_LABELS,
  isArabic,
  pick,
  type Relationship,
  type RequestType,
} from '../legalContent';

/**
 * `Merged-Public-Legal` §01, frames 11-14 — the public PDPL data-rights form and
 * its confirmation. Posts to `POST /api/privacy-request`.
 *
 * Changes worth naming, because they are behaviour and not just paint:
 *
 *  - **Multi-select request types.** The old single `<select>` meant a subject
 *    wanting access *and* deletion had to file twice; `request_types` was always
 *    a `text[]`.
 *  - **`restriction` added**, so all six PDPL rights the Privacy Policy promises
 *    are actually offered. The five-value list silently dropped one.
 *  - **`relationship` is now captured.** The column existed and rendered
 *    permanently null in the admin queue because nothing ever wrote it.
 *  - **Email is required.** The design makes it the reply channel ("so we can
 *    send our reply"), and with the phone confirmation unconfigured it is the
 *    only channel a reply can reach — labelling it optional would be untrue.
 *
 * The labels are the design's imperatives (Access / Correct / Delete / …); the
 * values posted are the PDPL right-names.
 */

const FIELD_CLASS =
  'w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30';

const LABEL_CLASS = 'mx-1 mb-1 mt-3 block text-xs font-semibold text-[var(--color-ink-body)]';

function chipClass(on: boolean): string {
  return [
    'chq-focus rounded-lg border-[1.5px] px-3 py-3 text-xs font-semibold transition-colors',
    on
      ? 'border-[var(--color-accent)] bg-[var(--color-mint)] text-[var(--color-accent-deep)]'
      : 'border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-mid)]',
  ].join(' ');
}

export default function PrivacyRequestPage() {
  const locale = useLocale();
  const isAr = isArabic(locale);
  const T = (v: { en: string; ar: string }) => pick(v, isAr);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [types, setTypes] = useState<Set<RequestType>>(new Set());
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const toggleType = (t: RequestType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const handleSubmit = async () => {
    setError(null);
    if (name.trim().length < 2) return setError(T(FORM_COPY.errorName));
    if (!phone.trim()) return setError(T(FORM_COPY.errorPhone));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(T(FORM_COPY.errorEmail));
    if (!relationship) return setError(T(FORM_COPY.errorRelationship));
    if (types.size === 0) return setError(T(FORM_COPY.errorTypes));

    setSubmitting(true);
    try {
      const res = await fetch('/api/privacy-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          relationship,
          requestTypes: Array.from(types),
          message: message.trim(),
          locale,
        }),
      });
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { confirmationSent?: boolean }
          | null;
        setConfirmationSent(payload?.confirmationSent === true);
        setDone(true);
        return;
      }
      setError(T(FORM_COPY.errorGeneric));
    } catch {
      setError(T(FORM_COPY.errorGeneric));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    const steps = [DONE_COPY.step1, DONE_COPY.step2, DONE_COPY.step3];
    return (
      <>
        <LegalChrome
          locale={locale}
          backHref="/legal"
          backIcon="x"
          backLabel={T(LEGAL_CHROME.backToLegal)}
          title={T(DONE_COPY.title)}
        />

        <div className="flex flex-1 flex-col items-center justify-center px-8 py-8 text-center">
          <div className="mb-4 flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <h2 className="mb-2 text-[22px] font-bold text-[var(--color-ink)]">
            {T(DONE_COPY.heading)}
          </h2>

          {/* Truthful by construction: the phone sentence renders only when the
              route actually reports a confirmation went out. */}
          <p className="max-w-[32ch] text-[13px] leading-[1.6] text-[var(--color-mid)]">
            {T(confirmationSent ? DONE_COPY.subtextPhone : DONE_COPY.subtextEmail)}
          </p>

          <div className="mt-4 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-[var(--color-hairline)] py-3 text-start last:border-b-0"
              >
                <span className="font-mono flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-tile)] text-[11px] font-bold text-[var(--color-mid)]">
                  {formatNumber(i + 1, locale)}
                </span>
                <p className="text-xs leading-[1.5] text-[var(--color-ink-body)]">
                  {renderInline(T(step), isAr)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-[var(--color-line)] bg-[var(--color-paper)] px-4 pb-6 pt-3">
          <Link
            href="/legal"
            className="chq-focus block w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-center text-[15px] font-bold text-[var(--color-ink-body)] transition-colors hover:bg-[var(--color-tile)]"
          >
            {T(LEGAL_CHROME.backToLegal)}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <LegalChrome
        locale={locale}
        backHref="/legal"
        backLabel={T(LEGAL_CHROME.backToAll)}
        title={T(FORM_COPY.title)}
        subtitle={T(FORM_COPY.subtitle)}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <div className="mx-1 rounded-xl border border-[var(--color-mint-deep)] bg-[var(--color-mint)] px-4 py-3 text-[11px] leading-[1.55] text-[var(--color-accent-deep)]">
          <b className="font-bold">{T(FORM_COPY.calloutLead)}</b> {T(FORM_COPY.calloutBody)}
        </div>

        <label className={LABEL_CLASS} htmlFor="pr-name">
          {T(FORM_COPY.nameLabel)}
        </label>
        <input
          id="pr-name"
          type="text"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          placeholder={T(FORM_COPY.namePlaceholder)}
          className={FIELD_CLASS}
        />

        <label className={LABEL_CLASS} htmlFor="pr-phone">
          {T(FORM_COPY.phoneLabel)}
        </label>
        <input
          id="pr-phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          maxLength={20}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={T(FORM_COPY.phonePlaceholder)}
          className={`${FIELD_CLASS} text-start`}
        />

        <label className={LABEL_CLASS} htmlFor="pr-email">
          {T(FORM_COPY.emailLabel)}{' '}
          <span className="text-[11px] font-normal text-[var(--color-muted)]">
            {T(FORM_COPY.emailHint)}
          </span>
        </label>
        <input
          id="pr-email"
          type="email"
          dir="ltr"
          value={email}
          maxLength={160}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={T(FORM_COPY.emailPlaceholder)}
          className={`${FIELD_CLASS} text-start`}
        />

        <span className={LABEL_CLASS}>{T(FORM_COPY.relationshipLabel)}</span>
        <div
          role="radiogroup"
          aria-label={T(FORM_COPY.relationshipLabel)}
          className="mt-1 flex flex-wrap gap-1"
        >
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={relationship === r}
              onClick={() => setRelationship(r)}
              className={chipClass(relationship === r)}
            >
              {T(RELATIONSHIP_LABELS[r])}
            </button>
          ))}
        </div>

        <span className={LABEL_CLASS}>{T(FORM_COPY.typesLabel)}</span>
        <div role="group" aria-label={T(FORM_COPY.typesLabel)} className="mt-1 flex flex-wrap gap-1">
          {REQUEST_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={types.has(t)}
              onClick={() => toggleType(t)}
              className={chipClass(types.has(t))}
            >
              {T(REQUEST_TYPE_LABELS[t])}
            </button>
          ))}
        </div>

        <label className={LABEL_CLASS} htmlFor="pr-details">
          {T(FORM_COPY.detailsLabel)}
        </label>
        <textarea
          id="pr-details"
          value={message}
          maxLength={2000}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={T(FORM_COPY.detailsPlaceholder)}
          className={FIELD_CLASS}
        />

        {error ? (
          <p
            role="alert"
            className="mx-1 mt-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-xs text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex-shrink-0 border-t border-[var(--color-line)] bg-[var(--color-paper)] px-4 pb-6 pt-3">
        <p className="mb-2 text-center text-[11px] leading-[1.45] text-[var(--color-muted)]">
          {T(FORM_COPY.footNote)}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="chq-focus flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] p-4 text-[15px] font-bold text-[var(--color-panel)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {submitting ? T(FORM_COPY.submitting) : T(FORM_COPY.submit)}
        </button>
      </div>
    </>
  );
}
