'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export function PaymobInvoiceModal({
  iframeUrl,
  sessionId,
  invoicePollId,
  title,
  iframeTitle,
  closeLabel,
  onClose,
  onSuccess,
  onError,
}: {
  iframeUrl: string;
  sessionId: string | null;
  invoicePollId: string | null;
  title: string;
  iframeTitle: string;
  closeLabel: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: () => void;
}) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  useEffect(() => {
    const pollId = sessionId ?? invoicePollId;
    if (!pollId) return;
    const interval = setInterval(async () => {
      const qs = sessionId
        ? `paymobOrderId=${encodeURIComponent(sessionId)}`
        : `invoiceId=${encodeURIComponent(invoicePollId!)}`;
      const { data: sessionWrap } = await supabase.auth.getSession();
      const token = sessionWrap?.session?.access_token;
      const res = await fetch(`/api/paymob/invoice-status?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as { status?: string; paid?: boolean; failed?: boolean };
      if (data.status === 'paid' || data.paid === true) {
        clearInterval(interval);
        onSuccessRef.current();
      }
      if (data.status === 'failed' || data.failed === true) {
        clearInterval(interval);
        onErrorRef.current();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, invoicePollId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-800/90 border border-slate-700">
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <span className="font-semibold text-slate-800">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto text-slate-500 hover:text-slate-800 btn-press chq-focus"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>
        <iframe src={iframeUrl} className="h-[600px] w-full" title={iframeTitle} />
      </div>
    </div>
  );
}
