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

const SWIPE_THRESHOLD = 60;
const MAX_SWIPE = 180;

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
      const actionWidth = Math.min(MAX_SWIPE, actions.length * 72);
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
      <div className="swipe-row-actions" style={{ width: `${offset}px` }}>
        {actions.map((action, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              action.onClick();
              close();
            }}
            className={`flex flex-col items-center justify-center gap-1 flex-1 text-xs font-medium px-3 min-w-[60px] transition-opacity duration-fast ${action.variant === 'danger' ? 'bg-[var(--color-danger)] text-white' : 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'}`}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
