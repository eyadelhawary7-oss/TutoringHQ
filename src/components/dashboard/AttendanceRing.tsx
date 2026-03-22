'use client';

type Props = {
  rate: number; // 0–100 percentage
  todayCount: number; // raw scan count today
  label: string; // translated label passed from parent
};

export function AttendanceRing({ rate, todayCount, label }: Props) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const clampedRate = Math.min(100, Math.max(0, rate));
  const dashOffset = circumference * (1 - clampedRate / 100);

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-shrink-0">
        <svg width="112" height="112" viewBox="0 0 112 112" style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke="var(--color-surface-3)"
            strokeWidth="10"
          />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke="var(--color-brand-500)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.6s var(--ease-out)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white leading-none">
            {clampedRate.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
        <span className="text-2xl font-bold text-white">
          {todayCount.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}
