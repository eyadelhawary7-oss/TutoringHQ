'use client';

import { cn } from '@/lib/utils';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  padding?: 'sm' | 'md' | 'lg' | 'none';
  /** Optional title rendered above children with admin Overview typography. */
  title?: React.ReactNode;
  children: React.ReactNode;
}

const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
} as const;

export default function Card({ padding = 'md', title, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm',
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {title != null && (
        <p className="text-sm font-medium mb-3 text-[var(--color-text-primary)]">{title}</p>
      )}
      {children}
    </div>
  );
}
