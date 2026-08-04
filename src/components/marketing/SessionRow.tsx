'use client';

/**
 * The `.row` object — the single element the whole landing page is built out
 * of: an avatar tile, a name over a sub line, and an optional value/status at
 * the end. Every marketing screen reuses it (hero, proof stack, the paired
 * object, the "only" lists), so it is one component with slots rather than four
 * near-copies.
 *
 * All sample content is passed in by the caller. Nothing here reads data.
 */
export default function SessionRow({
  initials,
  name,
  sub,
  value,
  status,
  statusColor = 'var(--color-accent)',
  tone = 'center',
  compact = false,
  className = '',
  avClassName = '',
  children,
}: {
  initials?: string;
  name: string;
  sub?: string;
  value?: string;
  status?: React.ReactNode;
  statusColor?: string;
  tone?: 'center' | 'teacher' | 'quiet';
  compact?: boolean;
  className?: string;
  avClassName?: string;
  children?: React.ReactNode;
}) {
  const avatarTone =
    tone === 'teacher'
      ? { backgroundColor: 'var(--color-sand)', color: 'var(--color-brass)' }
      : tone === 'quiet'
        ? { backgroundColor: 'var(--color-tile)', color: 'var(--color-muted)' }
        : { backgroundColor: 'var(--color-mint)', color: 'var(--color-accent-deep)' };

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] ${
        compact ? 'p-3' : 'px-4 py-3'
      } ${className}`}
    >
      {initials ? (
        <span
          className={`grid shrink-0 place-items-center rounded-lg text-[11px] font-bold ${avClassName}`}
          style={{ width: compact ? 29 : 32, height: compact ? 29 : 32, ...avatarTone }}
          aria-hidden
        >
          {initials}
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-tight text-[var(--color-ink)] [overflow-wrap:anywhere]">
          {name}
        </span>
        {sub ? (
          <span className="mt-1 block text-[11px] leading-snug text-[var(--color-muted)]">{sub}</span>
        ) : null}
      </span>

      {value || status ? (
        <span className="shrink-0 text-end">
          {value ? (
            <span className="mkt-mono block whitespace-nowrap text-[13px] text-[var(--color-ink)]">
              {value}
            </span>
          ) : null}
          {status ? (
            <span
              className="mt-1 block whitespace-nowrap text-[11px] font-bold tracking-[.06em]"
              style={{ color: statusColor }}
            >
              {status}
            </span>
          ) : null}
        </span>
      ) : null}

      {children}
    </div>
  );
}
