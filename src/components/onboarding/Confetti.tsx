'use client';

import { useEffect, useRef } from 'react';

const COLORS = [
  '#0D9488',
  '#14b8a6',
  '#F59E0B',
  '#EF4444',
  '#6366F1',
  '#EC4899',
  '#10B981',
  '#3B82F6',
];

type Props = {
  active: boolean;
  count?: number;
};

export function Confetti({ active, count = 40 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.cssText = `
        left: ${Math.random() * 100}vw;
        top: -10px;
        background: ${COLORS[Math.floor(Math.random() * COLORS.length)]};
        animation-delay: ${Math.random() * 0.8}s;
        animation-duration: ${1.8 + Math.random() * 1.2}s;
        width: ${6 + Math.random() * 6}px;
        height: ${6 + Math.random() * 6}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      `;
      container.appendChild(piece);
    }

    const cleanup = setTimeout(() => {
      if (container) container.innerHTML = '';
    }, 3500);

    return () => {
      clearTimeout(cleanup);
      if (container) container.innerHTML = '';
    };
  }, [active, count]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
