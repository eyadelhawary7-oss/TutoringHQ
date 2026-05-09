'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PROBE_MS = 60_000;
const TIMEOUT_MS = 5000;

async function probeHealth(): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function useNetworkStatus() {
  const [probeOk, setProbeOk] = useState(true);
  const [lastProbeAt, setLastProbeAt] = useState<number | null>(null);
  const [navOnline, setNavOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runProbe = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const ok = await probeHealth();
    setProbeOk(ok);
    setLastProbeAt(Date.now());
  }, []);

  useEffect(() => {
    const onNav = () => setNavOnline(navigator.onLine);
    window.addEventListener('online', onNav);
    window.addEventListener('offline', onNav);
    return () => {
      window.removeEventListener('online', onNav);
      window.removeEventListener('offline', onNav);
    };
  }, []);

  useEffect(() => {
    void runProbe();
    timerRef.current = setInterval(() => void runProbe(), PROBE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runProbe]);

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) void runProbe();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runProbe]);

  const online = probeOk && navOnline;

  return { online, lastProbeAt, probeOk, navOnline };
}
