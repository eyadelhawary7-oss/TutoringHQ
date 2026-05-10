'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { ChevronDown, Loader2 } from 'lucide-react';

const THRESHOLD = 80;
const REFRESH_MS = 1200;

type PullToRefreshProps = {
  children: ReactNode;
};

export function PullToRefresh({ children }: PullToRefreshProps) {
  const t = useTranslations('mobileShell');
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const pullDistRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);

  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const q = () => setWide(typeof window !== 'undefined' && window.innerWidth >= 768);
    q();
    window.addEventListener('resize', q);
    return () => window.removeEventListener('resize', q);
  }, []);

  useEffect(() => {
    if (wide) return;
    const el = scrollRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (el.scrollTop > 0) return;
      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return;
      if (el.scrollTop > 0) {
        pullingRef.current = false;
        pullDistRef.current = 0;
        setPullDist(0);
        return;
      }
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0) {
        e.preventDefault();
        const next = Math.min(dy * 0.45, 100);
        pullDistRef.current = next;
        setPullDist(next);
      } else {
        pullDistRef.current = 0;
        setPullDist(0);
      }
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      const d = pullDistRef.current;
      pullDistRef.current = 0;
      setPullDist(0);

      if (refreshingRef.current) return;
      if (d >= THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        void (async () => {
          await new Promise((r) => setTimeout(r, REFRESH_MS));
          router.refresh();
          refreshingRef.current = false;
          setRefreshing(false);
        })();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [wide, router]);

  const showIndicator = !wide && (pullDist > 0 || refreshing);
  const rotation = Math.min(pullDist / THRESHOLD, 1) * 180;

  return (
    <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-auto touch-pan-y">
      <div
        className="absolute top-0 start-0 end-0 flex flex-col items-center justify-end z-10 pointer-events-none overflow-hidden transition-[height,opacity] duration-fast ease-out"
        style={{
          height: refreshing ? 44 : pullDist > 0 ? Math.min(36 + pullDist * 0.35, 72) : 0,
          opacity: showIndicator ? 1 : 0,
        }}
        aria-hidden={!showIndicator}
      >
        {refreshing ? (
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin mb-1" aria-hidden />
        ) : (
          <>
            <ChevronDown
              className="w-6 h-6 text-brand-500 transition-transform duration-fast ease-out mb-0.5"
              style={{ transform: `rotate(${rotation}deg)` }}
              aria-hidden
            />
            <span className="text-xs text-[var(--color-text-secondary)] px-2 text-center">
              {pullDist >= THRESHOLD ? t('pull_release') : t('pull_hint')}
            </span>
          </>
        )}
      </div>

      <div
        className="min-h-full transition-transform duration-75 ease-out"
        style={{ transform: refreshing ? 'translateY(0)' : `translateY(${pullDist}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
