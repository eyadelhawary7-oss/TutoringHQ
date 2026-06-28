'use client';

// "No bill shock" card — shows the signed-in owner the exact amount + date of
// their first summer invoice (tier, subscription, processing fee, VAT inside,
// total, first-invoice date) so the number is one they've watched for weeks.
// Renders nothing when summer mode is off. Used in the billing area and, with
// `explainer`, on the onboarding Paymob step.

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/formatNumber';
import { buildRedesignedInvoiceLines } from '@/lib/processingFee';
import { summerAccent, type SummerPortal } from '@/lib/summer/copy';
import { formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

interface Projection {
  tierNameEn: string;
  tierNameAr: string;
  custom: boolean;
  subscriptionInclusive: number;
  overage: number;
  fee: number;
  total: number;
}
interface ApiResp {
  active: boolean;
  segment?: 'center' | 'teacher';
  firstInvoiceAt?: string;
  projection?: Projection;
}

interface Props {
  locale: string;
  /** Accent: teachers → bronze, centers/combined → forest green. */
  portal?: SummerPortal;
  /** Add the onboarding explainer copy (nothing now, pay then via Paymob, 2-day window). */
  explainer?: boolean;
}

export default function SummerFirstInvoiceCard({ locale, portal = 'combined', explainer = false }: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const isAr = locale === 'ar';
  const loc: 'ar' | 'en' = isAr ? 'ar' : 'en';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/summer/my-first-invoice')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as ApiResp);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.active || !data.projection) return null;
  const p = data.projection;
  const accent = summerAccent(portal);
  const tierName = isAr ? p.tierNameAr : p.tierNameEn;
  const dateLabel = data.firstInvoiceAt ? formatFloorLabel(data.firstInvoiceAt, loc) : '';

  const lines = p.custom
    ? []
    : buildRedesignedInvoiceLines({ total: p.total, fee: p.fee, locale: loc });

  return (
    <section
      className="rounded-2xl border p-5"
      style={{ backgroundColor: '#faf6ec', borderColor: `${accent}33` }}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <h3 className="text-lg font-bold" style={{ color: accent, fontFamily: 'var(--font-playfair), Georgia, serif' }}>
        {isAr ? 'فاتورتك الأولى' : 'Your first invoice'}
      </h3>
      <p className="mt-1 text-sm text-[#4a4030]">
        {isAr ? 'باقتك حسب استخدامك: ' : 'Your tier by usage: '}
        <span className="font-semibold">{tierName}</span>
        {dateLabel ? (
          <>
            {isAr ? ' — تصدر في ' : ' — issued on '}
            <span className="font-semibold">{dateLabel}</span>
          </>
        ) : null}
      </p>

      {p.custom ? (
        <p className="mt-3 text-sm text-[#4a4030]">
          {isAr ? 'باقة مخصّصة — تواصل معنا لمعرفة السعر.' : 'Custom plan — contact us for pricing.'}
        </p>
      ) : (
        <div className="mt-3 space-y-1">
          {lines.map((l) => (
            <div
              key={l.key}
              className={`flex items-center justify-between text-sm ${l.isTotal ? 'border-t pt-1 font-bold' : ''} ${l.isVatNote ? 'text-xs text-[#6b5d3a]' : 'text-[#4a4030]'}`}
              style={l.isTotal ? { borderColor: `${accent}33`, color: accent } : undefined}
            >
              <span>{l.label}</span>
              <span dir="ltr">{formatCurrency(l.amount, loc)}</span>
            </div>
          ))}
          {p.overage > 0 ? (
            <p className="pt-1 text-xs text-[#6b5d3a]">
              {isAr ? 'يشمل رسوم الطلاب الإضافيين.' : 'Includes extra-student usage.'}
            </p>
          ) : null}
        </div>
      )}

      {/* Referral CTA in the summer flow — reward is granted only when the referred
          customer pays their first invoice (pending through the free period). */}
      <a
        href={data.segment === 'teacher' ? '/teacher/settings' : '/referrals'}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        style={{ color: accent }}
      >
        {isAr
          ? 'ادعُ زميلًا — تكسب عندما يدفع أول فاتورة ←'
          : 'Refer a colleague — you earn when they pay their first invoice →'}
      </a>

      {explainer ? (
        <div className="mt-4 rounded-lg bg-white/60 p-3 text-xs leading-relaxed text-[#4a4030]">
          {isAr
            ? `حسابك يعمل الآن مجانًا. لا ندفع أي شيء عند التسجيل ولا نحفظ بطاقتك. أول فاتورة${dateLabel ? ` يوم ${dateLabel}` : ''} وتدفعها وقتها عبر Paymob (بطاقة أو محفظة أو إنستاباي أو فوري). لديك يومان للدفع، وبعدها يتحول الحساب للوضع المقروء فقط حتى الدفع.`
            : `Your account is active now, free. Nothing is charged at signup and no card is saved. Your first invoice${dateLabel ? ` lands on ${dateLabel}` : ''} and you pay it then via Paymob (card, wallet, InstaPay, or Fawry). You get a 2-day window to pay; after that the account goes read-only until paid.`}
        </div>
      ) : null}
    </section>
  );
}
