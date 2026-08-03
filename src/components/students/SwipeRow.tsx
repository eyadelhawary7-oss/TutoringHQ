'use client';

import React, { useCallback, useRef, useState, type ReactNode } from 'react';

type Action = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  variant: 'default' | 'danger';
};

type Props = {
  children: ReactNode;
  actions: Action[];
};

/**
 * `Merged-Design-Patterns` §03 draws the swipe row at `.sbtn{width:64px}` and
 * `.srowc{transform:translateX(-192px)}` — three actions of 64, 192 total.
 * These were 72 and 180, which made the third button visibly narrower than the
 * first two once the row was fully open.
 *
 * This stays a students-local component and is deliberately NOT promoted to
 * `components/patterns`. §06 is the file's own conclusion and it resolves §03
 * in favour of tap-to-expand plus the shared sheet; making a competing gesture
 * a primitive is how a list ends up with two ways to reach the same five
 * actions.
 */
const SWIPE_THRESHOLD = 60;
const MAX_SWIPE = 192;
const ACTION_WIDTH = 64;

export function SwipeRow({ children, actions }: Props) {
  const [offset, setOffset] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      startXRef.current = e.touches[0].clientX;
      startOffsetRef.current = offset;
    },
    [offset]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (startXRef.current === null) return;
      const delta = startXRef.current - e.touches[0].clientX;
      if (delta < 0 && !isOpen) return;
      const newOffset = Math.min(MAX_SWIPE, Math.max(0, startOffsetRef.current + delta));
      setOffset(newOffset);
    },
    [isOpen]
  );

  const handleTouchEnd = useCallback(() => {
    startXRef.current = null;
    if (offset > SWIPE_THRESHOLD) {
      const actionWidth = Math.min(MAX_SWIPE, actions.length * ACTION_WIDTH);
      setOffset(actionWidth);
      setIsOpen(true);
    } else {
      setOffset(0);
      setIsOpen(false);
    }
  }, [offset, actions.length]);

  const close = useCallback(() => {
    setOffset(0);
    setIsOpen(false);
  }, []);

  return (
    <div className="swipe-row" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="swipe-row-content" style={{ transform: `translateX(-${offset}px)` }}>
        {children}
      </div>
      <div
        className="swipe-row-actions lg:hidden"
        style={{ width: `${offset}px` }}
        aria-hidden={offset === 0}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              action.onClick();
              close();
            }}
            className={`flex flex-col items-center justify-center gap-1 flex-1 text-xs font-medium px-3 w-16 transition-opacity duration-fast ${action.variant === 'danger' ? 'bg-[var(--color-danger)] text-white' : 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'}`}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
