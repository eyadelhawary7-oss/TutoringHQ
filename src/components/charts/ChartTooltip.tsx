'use client';

import { CHART_STYLE } from './ChartTokens';

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number, name: string) => string;
  prefix?: string;
  suffix?: string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  prefix = '',
  suffix = '',
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const displayLabel = labelFormatter ? labelFormatter(label ?? '') : String(label ?? '');

  return (
    <div
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        minWidth: 140,
      }}
    >
      {displayLabel ? (
        <p
          style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
            fontFamily: CHART_STYLE.fontFamily,
          }}
        >
          {displayLabel}
        </p>
      ) : null}
      {payload.map((entry, i) => {
        const val = valueFormatter
          ? valueFormatter(entry.value, entry.name)
          : `${prefix}${entry.value.toLocaleString('en-US')}${suffix}`;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: entry.color,
                flexShrink: 0,
              }}
            />
            <div>
              {payload.length > 1 ? (
                <p
                  style={{
                    fontSize: 10,
                    color: 'var(--color-text-secondary)',
                    fontFamily: CHART_STYLE.fontFamily,
                    marginBottom: 1,
                  }}
                >
                  {entry.name}
                </p>
              ) : null}
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  fontFamily: CHART_STYLE.fontFamily,
                  lineHeight: 1,
                }}
              >
                {val}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
