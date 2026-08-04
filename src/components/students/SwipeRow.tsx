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
  /**
   * Merged-Center-Students §01 masthead: "A row swipes for pay / message / edit
   * / remove; long-press opens multi-select." Fires after LONG_PRESS_MS of a
   * stationary touch; any movement or lift cancels it, so it never competes with
   * the swipe gesture above. Long-press has no keyboard equivalent — the row
   * kebab carries a "Select" item as the accessible path.
   */
  onLongPress?: () => void;
};

const SWIPE_THRESHOLD = 60;
const MAX_SWIPE = 180;
const LONG_PRESS_MS = 500;

export function SwipeRow({ children, actions, onLongPress }: Props) {
  const [offset, setOffset] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      startXRef.current = e.touches[0].clientX;
      startOffsetRef.current = offset;
      cancelLongPress();
      if (onLongPress) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          onLongPress();
        }, LONG_PRESS_MS);
      }
    },
    [offset, onLongPress, cancelLongPress]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      cancelLongPress();
      if (startXRef.current === null) return;
      const delta = startXRef.current - e.touches[0].clientX;
      if (delta < 0 && !isOpen) return;
      const newOffset = Math.min(MAX_SWIPE, Math.max(0, startOffsetRef.current + delta));
      setOffset(newOffset);
    },
    [isOpen, cancelLongPress]
  );

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    startXRef.current = null;
    if (offset > SWIPE_THRESHOLD) {
      const actionWidth = Math.min(MAX_SWIPE, actions.length * 72);
      setOffset(actionWidth);
      setIsOpen(true);
    } else {
      setOffset(0);
      setIsOpen(false);
    }
  }, [offset, actions.length, cancelLongPress]);

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
