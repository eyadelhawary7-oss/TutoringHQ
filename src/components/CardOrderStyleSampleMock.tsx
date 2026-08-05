'use client';

import { cn } from '@/lib/utils';
import { colors } from '@/lib/tokens';

const TEAL = colors.brand[500];
const DARK_BG = '#0a1628';
const LIGHT_BG = '#ffffff';

function FakeQrGrid({ className }: { className?: string }) {
  const cells = Array.from({ length: 64 }, (_, i) => i);
  return (
    <g className={className}>
      {cells.map((i) => {
        const row = Math.floor(i / 8);
        const col = i % 8;
        const on = (row + col + (row % 3)) % 2 === 0;
        if (!on) return null;
        return (
          <rect
            key={i}
            x={6 + col * 6.5}
            y={6 + row * 6.5}
            width={5}
            height={5}
            rx={0.6}
            fill="currentColor"
            opacity={0.35}
          />
        );
      })}
    </g>
  );
}

function SampleWatermark({ textColor }: { textColor: string }) {
  return (
    <text
      x="135"
      y="78"
      textAnchor="middle"
      transform="rotate(-24 135 78)"
      fill={textColor}
      opacity={0.22}
      fontSize="14"
      fontWeight={700}
      fontFamily="system-ui, sans-serif"
      letterSpacing="0.2em"
    >
      SAMPLE
    </text>
  );
}

/** Keeps a long real name from running off the edge of a fixed-width SVG card. */
function fitToCard(raw: string | null | undefined, max: number, fallback: string): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return fallback;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function CardOrderStyleSampleMock({
  variant,
  className,
  centerName,
  studentName,
  studentNumber,
}: {
  variant: 'dark' | 'light';
  className?: string;
  /**
   * Real values, when the caller has them, so the preview shows the centre's
   * own card rather than a generic one. All three stay optional and fall back
   * to the neutral placeholders — never to an invented name. The SAMPLE
   * watermark stays on either way: this is a print preview, not a real card.
   */
  centerName?: string | null;
  studentName?: string | null;
  studentNumber?: string | null;
}) {
  const isDark = variant === 'dark';
  const centerLabel = fitToCard(centerName, 30, 'Center name');
  const studentLabel = fitToCard(studentName, 30, 'Student name');
  const numberLabel = fitToCard(studentNumber, 18, '#STU-00000');
  const bg = isDark ? DARK_BG : LIGHT_BG;
  const subtext = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(15,23,42,0.45)';
  const title = isDark ? colors.navy[50] : colors.navy[900];
  const qrColor = isDark ? colors.navy[200] : colors.navy[500];
  const wmColor = isDark ? '#ffffff' : colors.navy[900];

  return (
    <svg
      viewBox="0 0 270 170"
      className={cn('w-full h-auto', className)}
      role="img"
      aria-hidden
    >
      <rect x="0" y="0" width="270" height="170" rx="14" fill={bg} />
      <rect x="0" y="0" width="270" height="38" rx="14" fill={TEAL} />
      <rect x="0" y="24" width="270" height="14" fill={TEAL} />
      <circle cx="28" cy="19" r="10" fill="rgba(255,255,255,0.25)" />
      <text x="120" y="24" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight={600} fontFamily="system-ui, sans-serif">
        {centerLabel}
      </text>
      <text x="135" y="62" textAnchor="middle" fill={title} fontSize="11" fontWeight={600} fontFamily="system-ui, sans-serif">
        {studentLabel}
      </text>
      <text x="135" y="76" textAnchor="middle" fill={subtext} fontSize="9" fontFamily="ui-monospace, monospace">
        {numberLabel}
      </text>
      <g transform="translate(103,88)">
        <rect
          width="64"
          height="64"
          rx="6"
          fill="none"
          stroke={isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.55)'}
          strokeWidth="1.5"
        />
        <g style={{ color: qrColor }}>
          <FakeQrGrid />
        </g>
      </g>
      <text x="135" y="162" textAnchor="middle" fill={subtext} fontSize="8" fontFamily="system-ui, sans-serif">
        Powered by TutoringHQ
      </text>
      <SampleWatermark textColor={wmColor} />
    </svg>
  );
}
