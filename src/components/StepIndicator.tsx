'use client';

import { cn } from '@/lib/utils';

export interface StepIndicatorProps {
  /** 1-based current step */
  currentStep: number;
  labels: string[];
  className?: string;
}

export function StepIndicator({ currentStep, labels, className }: StepIndicatorProps) {
  const total = labels.length;

  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      <ol className="flex items-start justify-between gap-1 sm:gap-2">
        {labels.map((label, idx) => {
          const stepNum = idx + 1;
          const done = stepNum < currentStep;
          const active = stepNum === currentStep;

          return (
            <li key={idx} className="flex flex-1 flex-col items-center min-w-0">
              <div className="flex w-full items-center gap-1">
                {idx > 0 ? (
                  <span
                    className={cn(
                      'h-px flex-1 rounded-full min-w-[8px]',
                      stepNum <= currentStep ? 'bg-[color:var(--color-teal)]' : 'bg-[var(--color-border)]',
                    )}
                    aria-hidden
                  />
                ) : (
                  <span className="flex-1 min-w-[8px]" aria-hidden />
                )}
                <span
                  className={cn(
                    'flex h-2.5 w-2.5 shrink-0 rounded-full border-2 transition-colors',
                    done && 'border-[color:var(--color-teal)] bg-[color:var(--color-teal)]',
                    active && !done && 'border-[color:var(--color-teal)] bg-[color:var(--color-teal)]/25',
                    !active && !done && 'border-[var(--color-border)] bg-[var(--color-surface-1)]',
                  )}
                  aria-current={active ? 'step' : undefined}
                />
                {idx < total - 1 ? (
                  <span
                    className={cn(
                      'h-px flex-1 rounded-full min-w-[8px]',
                      done ? 'bg-[color:var(--color-teal)]' : 'bg-[var(--color-border)]',
                    )}
                    aria-hidden
                  />
                ) : (
                  <span className="flex-1 min-w-[8px]" aria-hidden />
                )}
              </div>
              <span
                className={cn(
                  'mt-1.5 text-[10px] sm:text-[11px] text-center leading-tight px-0.5 max-w-[7rem] sm:max-w-none',
                  active ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]',
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
