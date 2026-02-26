'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { X, Search, ChevronRight, ChevronLeft, RotateCcw } from 'lucide-react';
import QRCode from 'qrcode';
import { dbInsert } from '@/lib/db-proxy';
import { supabase } from '@/lib/supabase';
import { toAr } from '@/lib/number-utils';

interface Student {
  id: string;
  name: string;
  student_number?: string | null;
  qr_code?: string | null;
}

interface CenterInfo {
  name?: string;
  logo_url?: string;
}

interface CardOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  centerId: string;
  centerInfo: CenterInfo | null;
  onSuccess?: () => void;
}

const PRICE_PER_CARD = 3;

export function CardOrderModal({
  isOpen,
  onClose,
  students,
  centerId,
  centerInfo,
  onSuccess,
}: CardOrderModalProps) {
  const t = useTranslations('cardOrders');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const isRTL = locale === 'ar';

  const [step, setStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [cardSide, setCardSide] = useState<'front' | 'back'>('front');
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});

  const centerName = centerInfo?.name ?? 'CenterHQ';
  const centerLogo = centerInfo?.logo_url ?? null;
  const centerInitials = centerName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.student_number?.toUpperCase().includes(q.toUpperCase())
    );
  }, [students, searchQuery]);

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

  const quantity = selectedStudents.length;
  const subtotal = quantity * PRICE_PER_CARD;
  const totalAmount = subtotal + (deliveryFee || 0);

  const ensureQrCodes = useCallback(async () => {
    const needQr = selectedStudents.filter((s) => !qrDataUrls[s.id]);
    if (needQr.length === 0) return;
    const next: Record<string, string> = { ...qrDataUrls };
    for (const s of needQr) {
      try {
        const dataUrl = s.qr_code || (await QRCode.toDataURL(s.id, { width: 300, margin: 2 }));
        next[s.id] = dataUrl;
      } catch {
        next[s.id] = '';
      }
    }
    setQrDataUrls(next);
  }, [selectedStudents, qrDataUrls]);

  const handleNext = () => {
    if (step === 1 && selectedIds.size > 0) {
      ensureQrCodes();
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSubmit = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || !centerId) return;
    setIsSubmitting(true);
    try {
      const studentsPayload = selectedStudents.map((s) => ({
        id: s.id,
        name: s.name,
        student_number: s.student_number ?? '',
        qr_code: qrDataUrls[s.id] || s.qr_code || '',
      }));

      await dbInsert({
        table: 'card_orders',
        data: {
          center_id: centerId,
          created_by: session.user.id,
          students: studentsPayload,
          quantity,
          price_per_card: PRICE_PER_CARD,
          delivery_fee: deliveryFee,
          total_amount: totalAmount,
          status: 'pending',
          delivery_address: deliveryAddress.trim() || null,
          notes: notes.trim() || null,
        },
        select: false,
      });

      setSubmitSuccess(true);
      onSuccess?.();
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err) {
      console.error('Card order submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetModal = () => {
    setStep(1);
    setSelectedIds(new Set());
    setSearchQuery('');
    setDeliveryFee(0);
    setDeliveryAddress('');
    setNotes('');
    setSubmitSuccess(false);
    setCardSide('front');
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      onClick={handleClose}
    >
      <div
        className="bg-card rounded-2xl border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-bold text-foreground">
            {step === 1 && t('selectStudents')}
            {step === 2 && t('previewCard')}
            {step === 3 && t('orderSummary')}
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
          >
            <X size={20} />
          </button>
        </div>

        {submitSuccess ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400 text-3xl">
              ✓
            </div>
            <p className="text-lg font-medium text-foreground mb-2">{t('orderSuccess')}</p>
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Step 1: Select Students */}
            {step === 1 && (
              <>
                <div className="relative">
                  <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={tCommon('search')}
                    className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-input bg-background text-sm"
                    dir="auto"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={selectAll}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-muted"
                  >
                    {t('selectAll', { defaultValue: 'Select All' })}
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-muted"
                  >
                    {t('clear', { defaultValue: 'Clear' })}
                  </button>
                  <span className="text-sm text-muted-foreground ms-auto">
                    {t('studentsSelected', { count: selectedIds.size, defaultValue: `${selectedIds.size} students selected` })}
                  </span>
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
                      <span className="text-xs text-muted-foreground font-mono">{s.student_number || ''}</span>
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
                    className="relative w-full max-w-[320px] aspect-[85.6/54] rounded-xl overflow-hidden shadow-xl"
                    style={{ perspective: '1000px' }}
                  >
                    <div
                      className="relative w-full h-full transition-transform duration-500"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: cardSide === 'back' ? 'rotateY(180deg)' : 'rotateY(0deg)',
                      }}
                    >
                      {/* Front */}
                      <div
                        className="absolute inset-0 bg-white rounded-xl overflow-hidden"
                        style={{ backfaceVisibility: 'hidden' }}
                      >
                        <div
                          className="absolute top-0 left-0 right-0 h-[20%]"
                          style={{ background: 'linear-gradient(135deg, #0D9488 0%, #0f766e 100%)' }}
                        />
                        <div className="absolute top-0 left-0 right-0 h-[20%] flex items-center justify-between px-3 py-2">
                          {centerLogo ? (
                            <img src={centerLogo} alt="" className="h-6 w-6 object-contain" />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-teal-600 flex items-center justify-center text-white text-[10px] font-bold">
                              {centerInitials}
                            </div>
                          )}
                          <span className="text-white text-xs font-medium truncate max-w-[60%]">{centerName}</span>
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pt-[15%]">
                          <div className="w-[40%] aspect-square bg-white rounded-lg flex items-center justify-center shadow-md">
                            {selectedStudents[0] && (qrDataUrls[selectedStudents[0].id] || selectedStudents[0].qr_code) ? (
                              <img
                                src={qrDataUrls[selectedStudents[0].id] || selectedStudents[0].qr_code || ''}
                                alt="QR"
                                className="w-[85%] h-[85%] object-contain"
                              />
                            ) : (
                              <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                            )}
                          </div>
                          <div className="mt-2 text-center font-bold text-slate-900 text-sm">
                            {selectedStudents[0]?.name ?? '—'}
                          </div>
                          <div className="text-[10px] font-mono text-teal-600">
                            {selectedStudents[0]?.student_number ?? '—'}
                          </div>
                        </div>
                      </div>
                      {/* Back */}
                      <div
                        className="absolute inset-0 bg-white rounded-xl overflow-hidden"
                        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                      >
                        <div className="flex flex-col items-center justify-center h-full p-4">
                          {centerLogo ? (
                            <img src={centerLogo} alt="" className="w-[40%] max-w-[80px] object-contain" />
                          ) : (
                            <div className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center text-white text-lg font-bold">
                              {centerInitials}
                            </div>
                          )}
                          <div className="mt-2 font-bold text-slate-900 text-sm text-center">{centerName}</div>
                          <div className="absolute bottom-2 text-[8px] text-gray-400">{t('poweredBy')}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-center gap-2 mb-4">
                  <button
                    onClick={() => setCardSide('front')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${cardSide === 'front' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                  >
                    {t('frontOfCard')}
                  </button>
                  <button
                    onClick={() => setCardSide('back')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${cardSide === 'back' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                  >
                    {t('backOfCard')}
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('deliveryFee')} (EGP)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={deliveryFee}
                      onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('deliveryAddress', { defaultValue: 'Delivery Address' })}
                    </label>
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={t('deliveryAddressPlaceholder', { defaultValue: 'Enter delivery address...' })}
                      className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm min-h-[80px]"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">
                      {t('notesLabel', { defaultValue: 'Notes (optional)' })}
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t('notesPlaceholder', { defaultValue: 'Any special instructions...' })}
                      className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm min-h-[60px]"
                      rows={2}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Step 3: Order Summary */}
            {step === 3 && (
              <>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {selectedStudents.map((s) => (
                    <div key={s.id} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
                      <span className="font-medium">{s.name}</span>
                      <span className="font-mono text-muted-foreground">{s.student_number || '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{t('pricePerCard')}:</span>
                    <span className="font-mono">
                      {quantity} × EGP {PRICE_PER_CARD} = EGP {locale === 'ar' ? toAr(subtotal) : subtotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>{t('deliveryFee')}:</span>
                    <span className="font-mono">
                      EGP {locale === 'ar' ? toAr(deliveryFee) : deliveryFee.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-teal-600 pt-2 border-t border-border">
                    <span>{t('totalAmount')}:</span>
                    <span className="font-mono">
                      EGP {locale === 'ar' ? toAr(totalAmount) : totalAmount.toLocaleString()}
                    </span>
                  </div>
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
                  {isRTL ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                  {tCommon('back')}
                </span>
              )}
            </button>
            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={step === 1 && selectedIds.size === 0}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary disabled:opacity-50 flex items-center gap-1"
              >
                {tCommon('next')}
                {isRTL ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary disabled:opacity-50"
              >
                {isSubmitting ? tCommon('loading') : t('submitOrder')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
