'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useRouter } from '@/i18n/routing';

const PLAYFAIR = {
  fontFamily: "var(--font-playfair), 'Playfair Display', 'Didot', Georgia, serif",
  fontVariantNumeric: 'tabular-nums' as const,
  fontFeatureSettings: '"zero" 1, "tnum" 1',
} as const;
const SANS = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

type Labels = {
  header: string;
  helper: string;
  pinLabel: string;
  confirmLabel: string;
  show: string;
  hide: string;
  submit: string;
  submitting: string;
  errorWeak: string;
  errorMismatch: string;
  errorInvalidToken: string;
  errorAlreadySet: string;
  errorServer: string;
  errorNotFinalized: string;
  finalizingHeader: string;
  finalizingHelper: string;
  fallbackHeader: string;
  fallbackHelper: string;
  fallbackPhoneLabel: string;
  fallbackSubmit: string;
  fallbackSent: string;
};

type Props = {
  locale: 'ar' | 'en';
  mode: 'form' | 'finalizing' | 'fallback';
  urlToken?: string;
  labels: Labels;
};

export default function SetPinClient({ locale, mode: initialMode, urlToken, labels }: Props) {
  const [mode, setMode] = useState(initialMode);

  if (mode === 'finalizing') {
    return <FinalizingPoll labels={labels} onReady={() => setMode('form')} />;
  }
  if (mode === 'fallback') {
    void locale;
    return <FallbackForm labels={labels} />;
  }
  return <PinForm urlToken={urlToken} labels={labels} />;
}

function FrameWrap({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#080D14',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          border: '2px solid #0D9488',
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '12px',
        }}
      >
        <span style={{ ...PLAYFAIR, color: '#0D9488', fontWeight: 900, fontSize: '18px' }}>CH</span>
      </div>
      <div style={{ marginBottom: '44px' }}>
        <span
          style={{
            fontFamily: "var(--font-bodoni), 'Bodoni Moda', Georgia, serif",
            fontWeight: 700,
            letterSpacing: '2px',
            fontSize: '14px',
          }}
        >
          <span style={{ color: '#f8fafc' }}>CENTER</span>
          <span style={{ color: '#0D9488' }}>HQ</span>
        </span>
      </div>
      <div style={{ width: '100%', maxWidth: '420px' }}>{children}</div>
    </div>
  );
}

/* ------------- PinForm: the actual 6-digit double-entry surface. ------------- */

const SIX_CELLS = [0, 1, 2, 3, 4, 5] as const;

function PinForm({ urlToken, labels }: { urlToken?: string; labels: Labels }) {
  const router = useRouter();
  const [pin, setPin] = useState<string[]>(['', '', '', '', '', '']);
  const [confirm, setConfirm] = useState<string[]>(['', '', '', '', '', '']);
  const [show, setShow] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pinRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));
  const confirmRefs = useRef<Array<HTMLInputElement | null>>(Array(6).fill(null));

  const pinStr = pin.join('');
  const confirmStr = confirm.join('');
  const ready = pinStr.length === 6 && confirmStr.length === 6 && pinStr === confirmStr;

  const handleChange = (
    cells: string[],
    setCells: (next: string[]) => void,
    refs: React.MutableRefObject<Array<HTMLInputElement | null>>,
    nextRefs: React.MutableRefObject<Array<HTMLInputElement | null>> | null,
    idx: number,
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      const next = [...cells];
      next[idx] = '';
      setCells(next);
      return;
    }
    const next = [...cells];
    next[idx] = raw[raw.length - 1] ?? '';
    setCells(next);
    if (idx < 5) {
      refs.current[idx + 1]?.focus();
    } else if (nextRefs) {
      nextRefs.current[0]?.focus();
    }
    setError('');
  };

  const handleKeyDown = (
    cells: string[],
    setCells: (next: string[]) => void,
    refs: React.MutableRefObject<Array<HTMLInputElement | null>>,
    idx: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Backspace') {
      if (cells[idx]) {
        // Clear the current cell first; second backspace moves back.
        return;
      }
      if (idx > 0) {
        refs.current[idx - 1]?.focus();
        const next = [...cells];
        next[idx - 1] = '';
        setCells(next);
        e.preventDefault();
      }
    }
  };

  const handlePaste = (
    setCells: (next: string[]) => void,
    refs: React.MutableRefObject<Array<HTMLInputElement | null>>,
    e: ClipboardEvent<HTMLInputElement>,
  ) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setCells(next);
    const lastIdx = Math.min(text.length, 6) - 1;
    refs.current[lastIdx]?.focus();
  };

  const submit = async () => {
    if (!ready || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/set-initial-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pinStr,
          pinConfirm: confirmStr,
          token: urlToken ?? '',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        autoLogin?: boolean;
        error?: string;
      };
      if (!res.ok) {
        if (data.error === 'weak_pin') setError(labels.errorWeak);
        else if (data.error === 'mismatch') setError(labels.errorMismatch);
        else if (data.error === 'pin_already_set') setError(labels.errorAlreadySet);
        else if (data.error === 'not_finalized') setError(labels.errorNotFinalized);
        else if (data.error === 'token_invalid_or_used') setError(labels.errorInvalidToken);
        else setError(labels.errorServer);
        setSubmitting(false);
        return;
      }
      if (data.autoLogin) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    } catch {
      setError(labels.errorServer);
      setSubmitting(false);
    }
  };

  const cellsRow = (
    cells: string[],
    setCells: (next: string[]) => void,
    refs: React.MutableRefObject<Array<HTMLInputElement | null>>,
    nextRefs: React.MutableRefObject<Array<HTMLInputElement | null>> | null,
  ) => (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        marginInlineStart: 0,
        marginInlineEnd: 0,
      }}
      dir="ltr"
    >
      {SIX_CELLS.map((i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type={show ? 'text' : 'password'}
          inputMode="numeric"
          maxLength={1}
          value={cells[i]}
          onChange={(e) => handleChange(cells, setCells, refs, nextRefs, i, e)}
          onKeyDown={(e) => handleKeyDown(cells, setCells, refs, i, e)}
          onPaste={(e) => handlePaste(setCells, refs, e)}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          style={{
            ...PLAYFAIR,
            width: '44px',
            height: '52px',
            textAlign: 'center',
            fontSize: '22px',
            background: 'transparent',
            border: '1px solid #1e293b',
            borderRadius: '10px',
            color: '#f8fafc',
            outline: 'none',
            caretColor: '#0D9488',
          }}
        />
      ))}
    </div>
  );

  return (
    <FrameWrap>
      <h1
        style={{
          ...PLAYFAIR,
          color: '#f8fafc',
          fontSize: '24px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '8px',
        }}
      >
        {labels.header}
      </h1>
      <p
        style={{
          ...SANS,
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
          marginBottom: '32px',
        }}
      >
        {labels.helper}
      </p>

      <div style={{ marginBottom: '24px' }}>
        <div
          style={{
            ...SANS,
            fontSize: '9px',
            color: '#0D9488',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: 700,
            marginBottom: '8px',
            textAlign: 'start',
          }}
        >
          {labels.pinLabel}
        </div>
        {cellsRow(pin, setPin, pinRefs, confirmRefs)}
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div
          style={{
            ...SANS,
            fontSize: '9px',
            color: '#0D9488',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: 700,
            marginBottom: '8px',
            textAlign: 'start',
          }}
        >
          {labels.confirmLabel}
        </div>
        {cellsRow(confirm, setConfirm, confirmRefs, null)}
      </div>

      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        style={{
          ...SANS,
          background: 'transparent',
          border: 'none',
          color: '#94a3b8',
          fontSize: '11px',
          cursor: 'pointer',
          marginBottom: '24px',
          padding: 0,
          textAlign: 'start',
        }}
      >
        {show ? labels.hide : labels.show}
      </button>

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(239,68,68,0.3)',
            background: 'rgba(127,29,29,0.2)',
            color: '#f87171',
            fontSize: '12px',
            ...SANS,
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || submitting}
        style={{
          ...PLAYFAIR,
          width: '100%',
          padding: '15px',
          borderRadius: '12px',
          background: '#0D9488',
          color: 'white',
          border: 'none',
          fontSize: '14px',
          fontWeight: 700,
          cursor: ready && !submitting ? 'pointer' : 'default',
          opacity: ready && !submitting ? 1 : 0.4,
        }}
      >
        {submitting ? labels.submitting : labels.submit}
      </button>
    </FrameWrap>
  );
}

/* ------------- FinalizingPoll: redirect-vs-webhook race shell. ------------- */

function FinalizingPoll({ labels, onReady }: { labels: Labels; onReady: () => void }) {
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const res = await fetch('/api/signup/pin-setup-readiness', { method: 'GET' });
        const data = (await res.json().catch(() => ({}))) as { ready?: boolean };
        if (data.ready) {
          onReady();
          return;
        }
      } catch {
        /* swallow — keep polling */
      }
      if (attempts < 15 && !cancelled) {
        setTimeout(tick, 2000);
      }
    };
    const id = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [onReady]);

  return (
    <FrameWrap>
      <h1
        style={{
          ...PLAYFAIR,
          color: '#f8fafc',
          fontSize: '22px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '8px',
        }}
      >
        {labels.finalizingHeader}
      </h1>
      <p
        style={{
          ...SANS,
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
          marginBottom: '24px',
        }}
      >
        {labels.finalizingHelper}
      </p>
      <div
        aria-hidden
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(13,148,136,0.25)',
          borderTopColor: '#0D9488',
          borderRadius: '50%',
          margin: '0 auto',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </FrameWrap>
  );
}

/* ------------- FallbackForm: request a Set-PIN link via WhatsApp. ------------- */

function FallbackForm({ labels }: { labels: Labels }) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/auth/request-pin-setup-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
    } catch {
      /* Anti-enumeration: never differentiate. */
    }
    setSent(true);
    setSubmitting(false);
  };

  return (
    <FrameWrap>
      <h1
        style={{
          ...PLAYFAIR,
          color: '#f8fafc',
          fontSize: '22px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '8px',
        }}
      >
        {labels.fallbackHeader}
      </h1>
      <p
        style={{
          ...SANS,
          color: '#94a3b8',
          fontSize: '13px',
          textAlign: 'center',
          marginBottom: '24px',
        }}
      >
        {labels.fallbackHelper}
      </p>

      {sent ? (
        <div
          role="status"
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(45,212,191,0.35)',
            background: 'rgba(13,148,136,0.12)',
            color: '#99f6e4',
            fontSize: '13px',
            textAlign: 'center',
            ...SANS,
          }}
        >
          {labels.fallbackSent}
        </div>
      ) : (
        <>
          <div
            style={{
              ...SANS,
              fontSize: '9px',
              color: '#0D9488',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              fontWeight: 700,
              marginBottom: '8px',
              textAlign: 'start',
            }}
          >
            {labels.fallbackPhoneLabel}
          </div>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => {
              let v = e.target.value.replace(/[^0-9+]/g, '');
              if (v.length === 1 && v !== '+') v = '+20' + v;
              if (v.length <= 13) setPhone(v);
            }}
            placeholder="+20 1XXXXXXXXX"
            dir="ltr"
            style={{
              ...PLAYFAIR,
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid #1e293b',
              color: '#f8fafc',
              fontSize: '15px',
              padding: '10px 0',
              marginBottom: '24px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!phone || submitting}
            style={{
              ...PLAYFAIR,
              width: '100%',
              padding: '15px',
              borderRadius: '12px',
              background: '#0D9488',
              color: 'white',
              border: 'none',
              fontSize: '14px',
              fontWeight: 700,
              cursor: phone && !submitting ? 'pointer' : 'default',
              opacity: phone && !submitting ? 1 : 0.4,
            }}
          >
            {labels.fallbackSubmit}
          </button>
        </>
      )}
    </FrameWrap>
  );
}
