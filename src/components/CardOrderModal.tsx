'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { X, Search, ChevronRight, ChevronLeft, Check, CreditCard, Lock, Minus, Plus } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import QRCode from 'qrcode';
import { dbInsert, dbUpdate } from '@/lib/db-proxy';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';
import {
  CARD_UNIT_BASE_EGP,
  cardOrderProductInclusiveFromQty,
  explodeInclusive,
} from '@/lib/pricing/taxMath';
import { cn } from '@/lib/utils';
import { naturalCompare } from '@/lib/sort/naturalSort';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { getShippingFee, getShippingZone, formatShippingZoneForLocale } from '@/lib/bostaShipping';
import { StepIndicator } from '@/components/StepIndicator';
import { CardOrderStyleSampleMock } from '@/components/CardOrderStyleSampleMock';

const CARD_ORDER_PENDING_KEY = 'centerhq_card_order_pending';

const EGYPT_GOVERNORATES = [
  { value: 'cairo', labelAr: 'القاهرة', labelEn: 'Cairo' },
  { value: 'giza', labelAr: 'الجيزة', labelEn: 'Giza' },
  { value: 'alexandria', labelAr: 'الإسكندرية', labelEn: 'Alexandria' },
  { value: 'port_said', labelAr: 'بورسعيد', labelEn: 'Port Said' },
  { value: 'suez', labelAr: 'السويس', labelEn: 'Suez' },
  { value: 'asyut', labelAr: 'أسيوط', labelEn: 'Asyut' },
  { value: 'aswan', labelAr: 'أسوان', labelEn: 'Aswan' },
  { value: 'beheira', labelAr: 'البحيرة', labelEn: 'Beheira' },
  { value: 'beni_suef', labelAr: 'بني سويف', labelEn: 'Beni Suef' },
  { value: 'damietta', labelAr: 'دمياط', labelEn: 'Damietta' },
  { value: 'faiyum', labelAr: 'الفيوم', labelEn: 'Faiyum' },
  { value: 'gharbia', labelAr: 'الغربية', labelEn: 'Gharbia' },
  { value: 'ismailia', labelAr: 'الإسماعيلية', labelEn: 'Ismailia' },
  { value: 'kafr_el_sheikh', labelAr: 'كفر الشيخ', labelEn: 'Kafr El Sheikh' },
  { value: 'luxor', labelAr: 'الأقصر', labelEn: 'Luxor' },
  { value: 'matrouh', labelAr: 'مطروح', labelEn: 'Matrouh' },
  { value: 'minya', labelAr: 'المنيا', labelEn: 'Minya' },
  { value: 'monufia', labelAr: 'المنوفية', labelEn: 'Monufia' },
  { value: 'new_valley', labelAr: 'الوادي الجديد', labelEn: 'New Valley' },
  { value: 'north_sinai', labelAr: 'شمال سيناء', labelEn: 'North Sinai' },
  { value: 'qalyubia', labelAr: 'القليوبية', labelEn: 'Qalyubia' },
  { value: 'qena', labelAr: 'قنا', labelEn: 'Qena' },
  { value: 'red_sea', labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { value: 'sharqia', labelAr: 'الشرقية', labelEn: 'Sharqia' },
  { value: 'sohag', labelAr: 'سوهاج', labelEn: 'Sohag' },
  { value: 'south_sinai', labelAr: 'جنوب سيناء', labelEn: 'South Sinai' },
  { value: 'dakahlia', labelAr: 'الدقهلية', labelEn: 'Dakahlia' },
];

function governorateSelectLabel(g: (typeof EGYPT_GOVERNORATES)[number], isRTL: boolean): string {
  if (g.value === 'cairo') {
    const en = `\u2066${g.labelEn}\u2069`;
    const ar = `\u2067${g.labelAr}\u2069`;
    return isRTL ? `${ar} — ${en}` : `${en} — ${ar}`;
  }
  return isRTL ? g.labelAr : g.labelEn;
}

interface Student {
  id: string;
  name: string;
  student_number?: string | null;
  qr_code?: string | null;
}

interface CenterInfo {
  name?: string;
  logo_url?: string;
  phone?: string;
  governorate?: string;
  delivery_address?: DeliveryAddress;
}

interface DeliveryAddress {
  full_name?: string;
  phone?: string;
  governorate?: string;
  city?: string;
  street?: string;
  building?: string;
  landmark?: string;
}

interface CardOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  centerId: string;
  centerInfo: CenterInfo | null;
  onSuccess?: () => void;
  /** From `platform_config.bosta_shipping_rates`; omit to use code defaults only. */
  bostaShippingRates?: Record<string, number> | null;
}

export type QrCardStyle = 'dark' | 'light';

type DeliveryStepField = 'full_name' | 'phone' | 'governorate' | 'city' | 'street' | 'building';

export function CardOrderModal({
  isOpen,
  onClose,
  students,
  centerId,
  centerInfo,
  onSuccess,
  bostaShippingRates = null,
}: CardOrderModalProps) {
  const t = useTranslations('cardOrders');
  const tOrders = useTranslations('orders');
  const tStudents = useTranslations('students');
  const tCommon = useTranslations('common');
  const tPricing = useTranslations('pricing.lines');
  const locale = useLocale();
  const isRTL = locale === 'ar';

  const savedDelivery = centerInfo?.delivery_address;
  const hasSavedAddress = !!(savedDelivery && (savedDelivery.full_name || savedDelivery.phone || savedDelivery.governorate));

  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryForm, setDeliveryForm] = useState<DeliveryAddress>({
    full_name: '',
    phone: '',
    governorate: '',
    city: '',
    street: '',
    building: '',
    landmark: '',
  });
  const [useSavedAddress, setUseSavedAddress] = useState(true);
  const [notes, setNotes] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  type PaymentUiStatus = 'idle' | 'loading' | 'awaiting_payment' | 'paid' | 'failed';
  const [paymentStatus, setPaymentStatus] = useState<PaymentUiStatus>('idle');
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const [paymobIframeId, setPaymobIframeId] = useState<string | null>(null);
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);
  const [currentCardOrderId, setCurrentCardOrderId] = useState<string | null>(null);
  const [currentPaymobOrderId, setCurrentPaymobOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<QrCardStyle>('dark');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [orderExtraBlanks, setOrderExtraBlanks] = useState(false);
  const [extraBlankCount, setExtraBlankCount] = useState(1);
  const [step2Errors, setStep2Errors] = useState<Partial<Record<DeliveryStepField, string>>>({});
  const [termsInlineError, setTermsInlineError] = useState<string | null>(null);

  const centerName = centerInfo?.name ?? 'CenterHQ';
  const centerPhone = centerInfo?.phone ?? null;

  useEffect(() => {
    if (isOpen && hasSavedAddress) setUseSavedAddress(true);
    else if (isOpen && !hasSavedAddress) setUseSavedAddress(false);
  }, [isOpen, hasSavedAddress]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(CARD_ORDER_PENDING_KEY);
      if (raw == null || raw === '') return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.removeItem(CARD_ORDER_PENDING_KEY);
        return;
      }
      const ids = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (ids.length > 0) setSelectedIds(new Set(ids));
      localStorage.removeItem(CARD_ORDER_PENDING_KEY);
    } catch {
      localStorage.removeItem(CARD_ORDER_PENDING_KEY);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const hasSaved = savedDelivery && (savedDelivery.full_name || savedDelivery.phone || savedDelivery.governorate);
    if (hasSaved && useSavedAddress) {
      setDeliveryForm({
        full_name: savedDelivery!.full_name ?? '',
        phone: savedDelivery!.phone ?? '',
        governorate: savedDelivery!.governorate ?? '',
        city: savedDelivery!.city ?? '',
        street: savedDelivery!.street ?? '',
        building: savedDelivery!.building ?? '',
        landmark: savedDelivery!.landmark ?? '',
      });
    } else if (!useSavedAddress) {
      setDeliveryForm({ full_name: '', phone: '', governorate: '', city: '', street: '', building: '', landmark: '' });
    }
  }, [isOpen, savedDelivery, useSavedAddress]);

  const sortedStudents = useMemo(
    () =>
      [...students].sort((a, b) =>
        naturalCompare(String(a.student_number ?? ''), String(b.student_number ?? '')),
      ),
    [students],
  );

  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return sortedStudents;
    const q = searchQuery.toLowerCase().trim();
    return sortedStudents.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.student_number?.toUpperCase().includes(q.toUpperCase()),
    );
  }, [sortedStudents, searchQuery]);

  const selectedStudents = useMemo(
    () => students.filter((s) => selectedIds.has(s.id)),
    [students, selectedIds]
  );

  const toggleStudent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredStudents.map((s) => s.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const addNextFilteredToSelection = () => {
    const next = filteredStudents.find((s) => !selectedIds.has(s.id));
    if (next) toggleStudent(next.id);
  };

  const removeLastFilteredFromSelection = () => {
    for (let i = filteredStudents.length - 1; i >= 0; i -= 1) {
      const id = filteredStudents[i].id;
      if (selectedIds.has(id)) {
        toggleStudent(id);
        break;
      }
    }
  };

  const requireMsg = t('deliveryFieldRequired');

  const validateDeliveryField = (field: DeliveryStepField, d: DeliveryAddress): string | undefined => {
    const v = (k: keyof DeliveryAddress) => String(d[k] ?? '').trim();
    switch (field) {
      case 'full_name':
        return v('full_name') ? undefined : requireMsg;
      case 'phone':
        return v('phone') ? undefined : requireMsg;
      case 'governorate':
        return v('governorate') ? undefined : requireMsg;
      case 'city':
        return v('city') ? undefined : requireMsg;
      case 'street':
        return v('street') ? undefined : requireMsg;
      case 'building':
        return v('building') ? undefined : requireMsg;
      default:
        return undefined;
    }
  };

  const validateAllStep2 = (d: DeliveryAddress): Partial<Record<DeliveryStepField, string>> => {
    const fields: DeliveryStepField[] = ['full_name', 'phone', 'governorate', 'city', 'street', 'building'];
    const out: Partial<Record<DeliveryStepField, string>> = {};
    for (const f of fields) {
      const err = validateDeliveryField(f, d);
      if (err) out[f] = err;
    }
    return out;
  };

  const blurDeliveryField = (field: DeliveryStepField) => {
    setStep2Errors((prev) => ({
      ...prev,
      [field]: validateDeliveryField(field, deliveryForm),
    }));
  };

  const selectedGovernorate = deliveryForm.governorate?.trim() || null;
  const deliveryFee = getShippingFee(selectedGovernorate, bostaShippingRates);
  const shippingZoneEn = getShippingZone(selectedGovernorate, bostaShippingRates);
  const studentQty = selectedStudents.length;
  const extraQty = orderExtraBlanks ? Math.max(1, Math.min(500, Math.round(extraBlankCount))) : 0;
  const quantity = studentQty + extraQty;
  const cardsInclusiveTotal = useMemo(
    () => cardOrderProductInclusiveFromQty(quantity),
    [quantity],
  );
  const perCardInclusive = useMemo(() => cardOrderProductInclusiveFromQty(1), []);
  const taxParts = useMemo(() => explodeInclusive(cardsInclusiveTotal), [cardsInclusiveTotal]);
  const payTotal = cardsInclusiveTotal + deliveryFee;
  const perCardAllIn = quantity > 0 ? Math.round((payTotal / quantity) * 100) / 100 : 0;

  const handleNext = () => {
    if (step === 1 && selectedIds.size > 0) {
      setStep(2);
      return;
    }
    if (step === 2) {
      const errs = validateAllStep2(deliveryForm);
      setStep2Errors(errs);
      if (Object.keys(errs).length > 0) return;
      if (!termsAccepted) {
        setTermsInlineError(tOrders('cardOrderTermsRequired'));
        return;
      }
      setTermsInlineError(null);
      setStep(3);
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(1, s - 1));
  };

  const formatDeliveryForDisplay = (d: DeliveryAddress): string => {
    const parts = [
      d.full_name,
      d.phone,
      d.governorate ? EGYPT_GOVERNORATES.find((g) => g.value === d.governorate)?.labelAr ?? d.governorate : null,
      d.city,
      d.street,
      d.building,
      d.landmark,
    ].filter(Boolean);
    return parts.join('، ') || '';
  };

  const resetModal = () => {
    setStep(1);
    setSelectedIds(new Set());
    setSearchQuery('');
    setDeliveryForm({ full_name: '', phone: '', governorate: '', city: '', street: '', building: '', landmark: '' });
    setNotes('');
    setSubmitSuccess(false);
    setUseSavedAddress(hasSavedAddress);
    setSelectedStyle('dark');
    setPaymentStatus('idle');
    setPaymentKey(null);
    setPaymobIframeId(null);
    setPaymobIframeUrl(null);
    setCurrentCardOrderId(null);
    setCurrentPaymobOrderId(null);
    setPaymentError(null);
    setTermsAccepted(false);
    setTermsExpanded(false);
    setOrderExtraBlanks(false);
    setExtraBlankCount(1);
    setStep2Errors({});
    setTermsInlineError(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  const buildOrderPayload = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || !centerId) return null;
    const qrByStudentId: Record<string, string> = {};
    for (const s of selectedStudents) {
      try {
        qrByStudentId[s.id] =
          s.qr_code || (await QRCode.toDataURL(s.id, { width: 300, margin: 2 }));
      } catch {
        qrByStudentId[s.id] = '';
      }
    }
    const studentsPayload = selectedStudents.map((s) => ({
      id: s.id,
      name: s.name,
      student_number: s.student_number ?? '',
      qr_code: qrByStudentId[s.id] || s.qr_code || '',
    }));
    const deliveryPayload = {
      full_name: deliveryForm.full_name?.trim() || null,
      phone: deliveryForm.phone?.trim() || null,
      governorate: deliveryForm.governorate || null,
      city: deliveryForm.city?.trim() || null,
      street: deliveryForm.street?.trim() || null,
      building: deliveryForm.building?.trim() || null,
      landmark: deliveryForm.landmark?.trim() || null,
    };
    const deliveryDisplay = formatDeliveryForDisplay(deliveryForm);
    return {
      session,
      studentsPayload,
      deliveryPayload,
      deliveryDisplay,
    };
  };

  const handlePayNow = async () => {
    const built = await buildOrderPayload();
    if (!built) return;
    const { session, studentsPayload, deliveryPayload, deliveryDisplay } = built;

    setPaymentError(null);
    setPaymentStatus('loading');

    try {
      let orderId = currentCardOrderId;

      if (!orderId) {
        const extraNote = extraQty > 0 ? t('orderNotesExtraBlanks', { count: extraQty }) : '';
        const notesForOrder = [notes.trim(), extraNote].filter(Boolean).join('\n\n') || null;
        const { data: inserted, error: insertErr } = await dbInsert({
          table: 'card_orders',
          data: {
            center_id: centerId,
            created_by: session.user.id,
            students: studentsPayload,
            quantity,
            price_per_card: perCardInclusive,
            delivery_fee: deliveryFee,
            shipping_zone: shippingZoneEn,
            total_amount: payTotal,
            status: 'pending_payment',
            payment_status: 'pending_payment',
            delivery_address: deliveryDisplay || null,
            notes: notesForOrder,
            card_style: selectedStyle,
            delivery_governorate: selectedGovernorate,
          },
          select: 'id',
          single: true,
        });

        if (insertErr || !inserted || typeof inserted !== 'object' || !('id' in inserted)) {
          console.error('Card order insert error:', insertErr);
          setPaymentStatus('failed');
          setPaymentError(t('paymentFailed'));
          return;
        }

        orderId = (inserted as { id: string }).id;
        setCurrentCardOrderId(orderId);

        if (deliveryDisplay) {
          await dbUpdate({
            table: 'centers',
            data: { delivery_address: deliveryPayload },
            filters: [{ column: 'id', op: 'eq', value: centerId }],
          });
        }
      }

      const phoneForPaymob = (deliveryForm.phone?.trim() || centerPhone || '').replace(/\D/g, '');
      if (!session.access_token) {
        setPaymentStatus('failed');
        setPaymentError(t('paymentFailed'));
        return;
      }

      const res = await fetch('/api/paymob/create-payment-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: payTotal,
          centerName,
          centerPhone: phoneForPaymob || '0',
          cardOrderId: orderId,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        paymentKey?: string;
        iframeId?: string;
        paymobOrderId?: string;
        iframeUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.paymentKey || !json.iframeId || !json.paymobOrderId) {
        setPaymentStatus('failed');
        setPaymentError(typeof json.error === 'string' ? json.error : t('paymentFailed'));
        return;
      }

      setPaymentKey(json.paymentKey);
      setPaymobIframeId(json.iframeId);
      setPaymobIframeUrl(
        typeof json.iframeUrl === 'string'
          ? json.iframeUrl
          : `https://accept.paymob.com/api/acceptance/iframes/${json.iframeId}?payment_token=${encodeURIComponent(json.paymentKey)}`,
      );
      setCurrentPaymobOrderId(json.paymobOrderId);
      setPaymentStatus('awaiting_payment');
    } catch (err) {
      console.error('Card order pay error:', err);
      setPaymentStatus('failed');
      setPaymentError(t('paymentFailed'));
    }
  };

  const handlePaymentTryAgain = () => {
    setPaymentStatus('idle');
    setPaymentError(null);
    setPaymentKey(null);
    setPaymobIframeId(null);
    setPaymobIframeUrl(null);
    setCurrentPaymobOrderId(null);
  };

  const handleConfirmOrderAfterPayment = () => {
    setSubmitSuccess(true);
    onSuccess?.();
    setTimeout(() => {
      resetModal();
      onClose();
    }, 2000);
  };

  useEffect(() => {
    if (paymentStatus !== 'awaiting_payment' || !currentPaymobOrderId) return;

    let ticks = 0;
    const maxTicks = 200;
    const interval = setInterval(async () => {
      ticks += 1;
      if (ticks > maxTicks) {
        clearInterval(interval);
        return;
      }

      try {
        const { data: sessionWrap } = await supabase.auth.getSession();
        const token = sessionWrap?.session?.access_token;
        const res = await fetch(
          `/api/paymob/payment-status?paymobOrderId=${encodeURIComponent(currentPaymobOrderId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { paid?: boolean; failed?: boolean };
        if (body.paid === true) {
          setPaymentStatus('paid');
          clearInterval(interval);
        } else if (body.failed === true) {
          setPaymentStatus('failed');
          clearInterval(interval);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [paymentStatus, currentPaymobOrderId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      onClick={handleClose}
    >
      <div
        className="modal-spring-in bg-[var(--color-surface-1)] rounded-2xl border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center justify-between p-4 pb-2 gap-2">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {step === 1 && t('selectStudents')}
              {step === 2 && t('previewCard')}
              {step === 3 && t('orderSummary')}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-muted text-[var(--color-text-secondary)]"
            >
              <X size={20} />
            </button>
          </div>
          <div className="px-4 pb-3">
            <StepIndicator
              currentStep={step}
              labels={[t('selectStudents'), t('previewCard'), t('orderSummary')]}
            />
          </div>
        </div>

        {submitSuccess ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400 text-3xl">
              ✓
            </div>
            <p className="text-lg font-medium text-[var(--color-text-primary)]">{t('orderSuccess')}</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* Step 1: Select Students */}
            {step === 1 && (
              <>
                <div className="relative">
                  <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-secondary)]" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={tCommon('search')}
                    className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-input bg-[var(--color-surface-0)] text-sm"
                    dir="auto"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={removeLastFilteredFromSelection}
                    disabled={selectedIds.size === 0}
                    className="p-2 rounded-lg text-sm border border-border hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    aria-label={t('quantityStepDownAria')}
                  >
                    <Minus size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-muted"
                  >
                    {t('selectAll', { defaultValue: 'Select All' })}
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-muted"
                  >
                    {t('clear', { defaultValue: 'Clear' })}
                  </button>
                  <button
                    type="button"
                    onClick={addNextFilteredToSelection}
                    disabled={!filteredStudents.some((s) => !selectedIds.has(s.id))}
                    className="p-2 rounded-lg text-sm border border-border hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                    aria-label={t('quantityStepUpAria')}
                  >
                    <Plus size={16} aria-hidden />
                  </button>
                  <span className="text-sm text-[var(--color-text-secondary)] ms-auto">
                    {selectedIds.size === 1
                      ? tStudents('cardOrderCartSelected', { count: 1 })
                      : tStudents('cardOrderCartSelectedPlural', { count: selectedIds.size })}
                  </span>
                </div>
                <div className="rounded-xl border border-border p-3 space-y-3 bg-muted/10">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={orderExtraBlanks}
                      onChange={(e) => setOrderExtraBlanks(e.target.checked)}
                      className="rounded accent-primary"
                    />
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">{t('orderExtraBlanksToggle')}</span>
                  </label>
                  {orderExtraBlanks ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-[var(--color-text-secondary)]">{t('orderExtraBlanksLabel')}</span>
                      <button
                        type="button"
                        className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
                        disabled={extraBlankCount <= 1}
                        onClick={() => setExtraBlankCount((n) => Math.max(1, n - 1))}
                        aria-label={t('extraCardsDecreaseAria')}
                      >
                        <Minus size={14} aria-hidden />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={extraBlankCount}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value));
                          if (!Number.isFinite(n)) return;
                          setExtraBlankCount(Math.min(500, Math.max(1, n)));
                        }}
                        className="w-16 px-2 py-1.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm text-center font-mono"
                      />
                      <button
                        type="button"
                        className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
                        disabled={extraBlankCount >= 500}
                        onClick={() => setExtraBlankCount((n) => Math.min(500, n + 1))}
                        aria-label={t('extraCardsIncreaseAria')}
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                      <p className="text-xs text-[var(--color-text-tertiary)] w-full sm:w-auto">{t('orderExtraBlanksHint')}</p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                  {selectedStudents.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-primary/20 text-primary"
                    >
                      {s.name}
                      <button
                        onClick={() => toggleStudent(s.id)}
                        className="hover:bg-primary/30 rounded p-0.5"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-xl p-2">
                  {filteredStudents.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleStudent(s.id)}
                        className="rounded accent-primary"
                      />
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-[var(--color-text-secondary)] font-mono">
                        {s.student_number ? formatStudentNumberForDisplay(s.student_number) : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Step 2: Preview & Customize */}
            {step === 2 && (
              <>
                <div className="flex justify-center mb-4">
                  <div
                    className="w-full max-w-[320px] rounded-xl border border-dashed border-stone-300 bg-stone-50/50 dark:bg-stone-950/25 p-3 space-y-2"
                    role="region"
                    aria-label={tOrders('cardPreviewLockedTitle')}
                  >
                    <div className="flex items-start gap-2 text-stone-600 dark:text-stone-400">
                      <Lock size={16} className="shrink-0 mt-0.5 opacity-80" aria-hidden />
                      <p className="text-[12px] font-medium leading-snug">{tOrders('cardPreviewLockedTitle')}</p>
                    </div>
                    <CardOrderStyleSampleMock variant={selectedStyle} className="rounded-lg overflow-hidden shadow-sm" />
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 text-center leading-snug">
                      {tOrders('cardPreviewLockedSub')}
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div title={tOrders('cardStyleOptionAReservedHint')}>
                    <p className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                      {tOrders('cardStyleLabel')}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedStyle('dark')}
                        className={cn(
                          'rounded-xl border-2 p-3 text-start transition-shadow',
                          selectedStyle === 'dark'
                            ? 'ring-2 ring-[color:var(--color-teal)] border-[color:var(--color-teal)]'
                            : 'border-[var(--color-border)]',
                        )}
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          {tOrders('cardStyleOptionB')}
                        </span>
                        <span className="mt-0.5 block text-xs font-medium text-[var(--color-text-primary)]">
                          {tOrders('cardStyleDark')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedStyle('light')}
                        className={cn(
                          'rounded-xl p-3 text-start transition-shadow',
                          selectedStyle === 'light'
                            ? 'border-2 ring-2 ring-[color:var(--color-teal)] border-[color:var(--color-teal)]'
                            : 'border border-stone-300 dark:border-[var(--color-border)] shadow-sm',
                        )}
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          {tOrders('cardStyleOptionC')}
                        </span>
                        <span className="mt-0.5 block text-xs font-medium text-[var(--color-text-primary)]">
                          {tOrders('cardStyleLight')}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3 border border-border rounded-xl p-4 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="use-saved-addr"
                        checked={useSavedAddress}
                        onChange={(e) => setUseSavedAddress(e.target.checked)}
                        disabled={!hasSavedAddress}
                        className="rounded accent-primary"
                      />
                      <label htmlFor="use-saved-addr" className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t('useSavedAddress', { defaultValue: 'Use saved address' })}
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('fullName', { defaultValue: 'Full name' })}</label>
                        <input
                          type="text"
                          value={deliveryForm.full_name}
                          onChange={(e) => {
                            setDeliveryForm((f) => ({ ...f, full_name: e.target.value }));
                            setStep2Errors((prev) => ({ ...prev, full_name: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('full_name')}
                          placeholder={t('fullNamePlaceholder', { defaultValue: 'الاسم الكامل' })}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                          dir="auto"
                        />
                        {step2Errors.full_name ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.full_name}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('phone', { defaultValue: 'Phone' })}</label>
                        <input
                          type="tel"
                          value={deliveryForm.phone}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d+]/g, '');
                            setDeliveryForm((f) => ({ ...f, phone: v }));
                            setStep2Errors((prev) => ({ ...prev, phone: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('phone')}
                          placeholder="+20 1XXXXXXXX"
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm font-mono"
                          dir="ltr"
                        />
                        {step2Errors.phone ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.phone}</p>
                        ) : null}
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('governorate', { defaultValue: 'Governorate' })}</label>
                        <select
                          value={deliveryForm.governorate}
                          onChange={(e) => {
                            setDeliveryForm((f) => ({ ...f, governorate: e.target.value }));
                            setStep2Errors((prev) => ({ ...prev, governorate: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('governorate')}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                        >
                          <option value="">{t('selectGovernorate', { defaultValue: 'اختر المحافظة' })}</option>
                          {EGYPT_GOVERNORATES.map((g) => (
                            <option key={g.value} value={g.value}>{governorateSelectLabel(g, isRTL)}</option>
                          ))}
                        </select>
                        {step2Errors.governorate ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.governorate}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('cityDistrict', { defaultValue: 'City / District' })}</label>
                        <input
                          type="text"
                          value={deliveryForm.city}
                          onChange={(e) => {
                            setDeliveryForm((f) => ({ ...f, city: e.target.value }));
                            setStep2Errors((prev) => ({ ...prev, city: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('city')}
                          placeholder={t('cityPlaceholder', { defaultValue: 'المدينة / الحي' })}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                          dir="auto"
                        />
                        {step2Errors.city ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.city}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('streetAddress', { defaultValue: 'Street address' })}</label>
                        <input
                          type="text"
                          value={deliveryForm.street}
                          onChange={(e) => {
                            setDeliveryForm((f) => ({ ...f, street: e.target.value }));
                            setStep2Errors((prev) => ({ ...prev, street: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('street')}
                          placeholder={t('streetPlaceholder', { defaultValue: 'الشارع' })}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                          dir="auto"
                        />
                        {step2Errors.street ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.street}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('buildingApartment', { defaultValue: 'Building / Apartment' })}</label>
                        <input
                          type="text"
                          value={deliveryForm.building}
                          onChange={(e) => {
                            setDeliveryForm((f) => ({ ...f, building: e.target.value }));
                            setStep2Errors((prev) => ({ ...prev, building: undefined }));
                          }}
                          onBlur={() => blurDeliveryField('building')}
                          placeholder={t('buildingPlaceholder', { defaultValue: 'المبنى / الشقة' })}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                          dir="auto"
                        />
                        {step2Errors.building ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{step2Errors.building}</p>
                        ) : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('landmarkOptional', { defaultValue: 'Landmark (optional)' })}</label>
                        <input type="text" value={deliveryForm.landmark} onChange={(e) => setDeliveryForm((f) => ({ ...f, landmark: e.target.value }))} placeholder={t('landmarkPlaceholder', { defaultValue: 'علامة مميزة' })} className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" dir="auto" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                      {t('notesLabel', { defaultValue: 'Notes (optional)' })}
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t('notesPlaceholder', { defaultValue: 'Any special instructions...' })}
                      className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm min-h-[60px]"
                      rows={2}
                    />
                  </div>
                  <div className="pt-1">
                    <div className="flex gap-2 items-start">
                      <input
                        id="card-order-terms"
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => {
                          setTermsAccepted(e.target.checked);
                          setTermsInlineError(null);
                        }}
                        className="mt-1 h-4 w-4 shrink-0 rounded accent-[color:var(--color-teal)]"
                      />
                      <div className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">
                        <label htmlFor="card-order-terms" className="cursor-pointer">
                          {tOrders('cardOrderTermsLabel')}{' '}
                        </label>
                        <button
                          type="button"
                          className="text-[color:var(--color-teal)] underline"
                          onClick={(e) => {
                            e.preventDefault();
                            setTermsExpanded((v) => !v);
                          }}
                        >
                          {tOrders('cardOrderTermsLink')}
                        </button>
                      </div>
                    </div>
                    {termsExpanded ? (
                      <div className="mt-1.5 rounded-lg border border-[#e5e7eb] bg-[var(--color-surface-1)] p-3 text-[11px] text-[#6b7280]">
                        {tOrders('cardOrderTermsBody')}
                      </div>
                    ) : null}
                    {termsInlineError ? (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{termsInlineError}</p>
                    ) : null}
                  </div>
                </div>
              </>
            )}

            {/* Step 3: Order Summary */}
            {step === 3 && (
              <>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {selectedStudents.map((s) => (
                    <div key={s.id} className="flex justify-between gap-2 text-sm py-1 border-b border-border last:border-0">
                      <span className="font-medium min-w-0">
                        <bdi dir="rtl">{s.name}</bdi>
                      </span>
                      <span className="font-mono text-[var(--color-text-secondary)] shrink-0">
                        {s.student_number ? (
                          <bdi dir="ltr">{formatStudentNumberForDisplay(s.student_number)}</bdi>
                        ) : (
                          '-'
                        )}
                      </span>
                    </div>
                  ))}
                  {extraQty > 0 ? (
                    <p className="text-xs text-[var(--color-text-tertiary)] pt-1 border-t border-dashed border-[var(--color-border)]">
                      {t('orderSummaryExtraBlanksLine', { count: extraQty })}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex justify-between gap-3 text-sm font-medium">
                    <span className="text-[var(--color-text-primary)]">
                      {t('orderSummaryProductInclusive')}
                    </span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(taxParts.inclusive, locale)}</span>
                  </div>
                  <div className="border-t border-dashed border-[var(--color-border)]" />
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">{tPricing('inclVat')}</span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(taxParts.vat, locale)}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">{tPricing('inclStamp')}</span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(taxParts.stamp, locale)}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">{tPricing('inclService')}</span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(taxParts.service, locale)}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">{tPricing('netBase')}</span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(taxParts.base, locale)}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-3 items-start">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[11px] text-[var(--color-text-tertiary)] leading-snug">
                          {t('orderSummaryBreakdownCards', {
                            qty: quantity,
                            unit: formatCurrency(CARD_UNIT_BASE_EGP, locale),
                          })}
                        </p>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-[11px] text-[var(--color-text-tertiary)] underline decoration-[var(--color-border)] hover:text-[color:var(--color-teal)]"
                        >
                          {t('orderSummaryChangeQuantity')}
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-tertiary)] opacity-90">
                      {t('orderSummaryPerCardAllIn', { amount: formatCurrency(perCardAllIn, locale) })}
                    </p>
                  </div>
                  <div className="border-t border-[var(--color-border)]" />
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">
                      {t('orderSummaryShippingZone', { zone: formatShippingZoneForLocale(shippingZoneEn, locale) })}
                    </span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(deliveryFee, locale)}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] -mt-1">{t('deliveryFeeNote')}</p>
                  <div className="border-t-2 border-[color:var(--color-teal)] pt-2 mt-1" />
                  <div className="flex justify-between font-bold text-[color:var(--color-teal)] gap-3">
                    <span>{t('orderSummaryTotal')}</span>
                    <span className="font-mono text-end tabular-nums">{formatCurrency(payTotal, locale)}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/10">
                  <div className="flex items-start gap-3">
                    <CreditCard className="w-5 h-5 text-[color:var(--color-teal)] shrink-0 mt-0.5" aria-hidden />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('paymentTitle')}</h3>
                    </div>
                  </div>
                  {paymentError && (
                    <p className="text-sm text-red-600 dark:text-red-400">{paymentError}</p>
                  )}
                  {paymentStatus === 'idle' && (
                    <button
                      type="button"
                      onClick={handlePayNow}
                      className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-[color:var(--color-teal)] hover:opacity-90 flex items-center justify-center gap-2"
                    >
                      <CreditCard size={18} aria-hidden />
                      {t('payNow')} - {formatCurrency(payTotal, locale)}
                    </button>
                  )}
                  {paymentStatus === 'loading' && (
                    <div className="flex items-center justify-center gap-3 py-4 text-[var(--color-text-secondary)]">
                      <div className="w-8 h-8 border-2 border-[color:var(--color-teal)] border-t-transparent rounded-full animate-spin shrink-0" />
                      <span className="text-sm">{t('paymentLoading')}</span>
                    </div>
                  )}
                  {paymentStatus === 'awaiting_payment' && paymentKey && (paymobIframeUrl || paymobIframeId) && (
                    <div className="flex flex-col gap-3 overflow-visible">
                      <p className="text-sm text-[var(--color-text-secondary)]">{t('awaitingPayment')}</p>
                      <iframe
                        src={
                          paymobIframeUrl ??
                          `https://accept.paymob.com/api/acceptance/iframes/${paymobIframeId}?payment_token=${encodeURIComponent(paymentKey)}`
                        }
                        className="w-full rounded-lg border-0"
                        style={{ height: '600px', minHeight: '600px' }}
                        title="Paymob Payment"
                      />
                    </div>
                  )}
                  {paymentStatus === 'paid' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                        <Check size={22} className="shrink-0" strokeWidth={2.5} />
                        <span className="text-sm font-medium">{t('paymentSuccess')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleConfirmOrderAfterPayment}
                        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-[color:var(--color-teal)] hover:opacity-90"
                      >
                        {t('submitOrder')}
                      </button>
                    </div>
                  )}
                  {paymentStatus === 'failed' && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">{t('paymentFailed')}</p>
                      <button
                        type="button"
                        onClick={handlePaymentTryAgain}
                        className="w-full py-2.5 rounded-lg text-sm font-semibold border border-border hover:bg-muted"
                      >
                        {t('tryAgain')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {!submitSuccess && (
          <div className="flex items-center justify-between p-4 border-t border-border shrink-0 gap-2">
            <button
              onClick={step === 1 ? handleClose : handleBack}
              className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-muted"
            >
              {step === 1 ? tCommon('cancel') : (
                <span className="flex items-center gap-1">
                  <DirectionalIcon icon={ChevronLeft} className="h-4 w-4" />
                  {tCommon('back')}
                </span>
              )}
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={step === 1 && selectedIds.size === 0}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary disabled:opacity-50 flex items-center gap-1"
              >
                {tCommon('next')}
                <DirectionalIcon icon={ChevronRight} className="h-4 w-4" />
              </button>
            ) : (
              <div className="w-24 shrink-0" aria-hidden />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
