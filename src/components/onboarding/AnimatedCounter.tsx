'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  target: number;
  duration?: number;
  className?: string;
};

export function AnimatedCounter({
  target,
  duration = 1500,
  className = '',
}: Props) {
  const [current, setCurrent] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) {
      setCurrent(0);
      return;
    }
    startTimeRef.current = null;

    const step = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return <span className={className}>{current.toLocaleString('en-US')}</span>;
}
