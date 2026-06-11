'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, CheckCircle2 } from 'lucide-react';

/**
 * Public PDPL data-rights request form. Submits to POST /api/privacy-request.
 * Bilingual-inline (locale switch), cream, RTL logical props.
 */
type RequestType = 'access' | 'correction' | 'deletion' | 'portability' | 'objection';

export default function PrivacyRequestPage() {
  const locale = useLocale();
  const isAr = locale === 'ar' || locale.startsWith('ar-');

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('access');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const t = {
    title: isAr ? 'طلب حقوق البيانات الشخصية' : 'Personal Data Rights Request',
    subtitle: isAr
      ? 'قدّم طلباً بخصوص بياناتك الشخصية بموجب قانون حماية البيانات المصري.'
      : 'Submit a request regarding your personal data under the Egyptian PDPL.',
    name: isAr ? 'الاسم' : 'Name',
    contact: isAr ? 'الهاتف أو البريد الإلكتروني' : 'Phone or email',
    type: isAr ? 'نوع الطلب' : 'Request type',
    message: isAr ? 'تفاصيل الطلب' : 'Message',
    submit: isAr ? 'إرسال الطلب' : 'Submit request',
    submitting: isAr ? 'جارٍ الإرسال...' : 'Submitting...',
    error: isAr ? 'حدث خطأ ما. حاول مرة أخرى.' : 'Something went wrong. Please try again.',
    success: isAr
      ? 'تم استلام طلبك. سنتواصل معك قريباً.'
      : 'Your request has been received. We will be in touch shortly.',
    types: {
      access: isAr ? 'الاطلاع على البيانات' : 'Access',
      correction: isAr ? 'تصحيح البيانات' : 'Correction',
      deletion: isAr ? 'حذف البيانات' : 'Deletion',
      portability: isAr ? 'نقل البيانات' : 'Portability',
      objection: isAr ? 'الاعتراض على المعالجة' : 'Objection',
    } as Record<RequestType, string>,
  };

  const handleSubmit = async () => {
    setError(null);
    if (name.trim().length < 2 || !contact.trim()) {
      setError(t.error);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/privacy-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim(),
          requestType,
          message: message.trim(),
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setError(t.error);
    } catch {
      setError(t.error);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal-deep)] focus:ring-2 focus:ring-[var(--color-teal-deep)]/30';

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <CheckCircle2 size={48} className="mx-auto text-[var(--color-teal-deep)]" aria-hidden />
        <p className="mt-4 text-[var(--color-text-primary)]">{t.success}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 md:py-14">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t.title}</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t.subtitle}</p>

      <div className="mt-8 flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t.name}
          </label>
          <input
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t.contact}
          </label>
          <input
            type="text"
            value={contact}
            maxLength={160}
            onChange={(e) => setContact(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t.type}
          </label>
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as RequestType)}
            className={inputClass}
          >
            {(Object.keys(t.types) as RequestType[]).map((key) => (
              <option key={key} value={key}>
                {t.types[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
            {t.message}
          </label>
          <textarea
            value={message}
            maxLength={2000}
            rows={4}
            onChange={(e) => setMessage(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-teal-deep)] px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitting ? t.submitting : t.submit}
        </button>
      </div>
    </div>
  );
}
