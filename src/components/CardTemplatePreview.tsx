'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { colors } from '@/lib/tokens';

function getContrastColor(hex: string): string {
  if (!hex?.startsWith('#')) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? colors.navy[900] : '#FFFFFF';
}

interface CardTemplatePreviewProps {
  centerName: string;
  centerLogo: string | null;
  studentName: string;
  studentNumber: string;
  /** data:image/png;base64,... from card_orders.students[0].qr_code */
  qrCode?: string | null;
  /** Legacy single accent (ignored when cardStyle is set) */
  color?: string;
  /** Option B / C layout */
  cardStyle?: 'dark' | 'light';
  className?: string;
}

export default function CardTemplatePreview({
  centerName,
  centerLogo,
  studentName,
  studentNumber,
  qrCode,
  color = colors.brand[500],
  cardStyle,
  className,
}: CardTemplatePreviewProps) {
  const initials = centerName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const usePreset = cardStyle === 'dark' || cardStyle === 'light';
  const faceBg = cardStyle === 'light' ? '#ffffff' : '#0a1628';
  const nameClass =
    cardStyle === 'light' ? 'text-[color:var(--color-navy-900)]' : 'text-[var(--color-text-primary)]';

  if (usePreset) {
    return (
      <div
        className={cn(
          'relative w-48 aspect-[85.6/54] rounded-xl overflow-hidden shadow-lg border border-[var(--color-border-subtle)] flex flex-col',
          className,
        )}
        style={{ backgroundColor: faceBg }}
      >
        <div className="h-[20%] shrink-0 bg-[color:var(--color-teal)] flex items-center justify-between px-2 py-1">
          {centerLogo ? (
            <img src={centerLogo} alt="" className="h-5 w-5 object-contain" />
          ) : (
            <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold bg-[color:var(--color-teal)]">
              {initials}
            </div>
          )}
          <span className="text-[10px] font-medium text-white truncate max-w-[60%]">{centerName}</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-2 pb-2 pt-2">
          <div
            className={cn(
              'w-16 h-16 rounded flex items-center justify-center border-2 border-[var(--color-border-subtle)] overflow-hidden',
              cardStyle === 'light' ? 'bg-[var(--color-surface-0)]' : 'bg-[var(--color-surface-2)]',
            )}
          >
            {qrCode ? (
              <img src={qrCode} alt="QR Code" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">QR</span>
            )}
          </div>
          <div className={cn('mt-1 text-xs font-bold truncate max-w-full px-1', nameClass)}>{studentName}</div>
          <div className="text-[9px] font-mono truncate max-w-full px-1 text-[color:var(--color-teal)]">
            {studentNumber}
          </div>
        </div>
      </div>
    );
  }

  const headerTextColor = getContrastColor(color);
  return (
    <div
      className={cn(
        'relative w-48 aspect-[85.6/54] rounded-xl overflow-hidden shadow-lg border border-border bg-[var(--color-surface-1)]',
        className,
      )}
      style={{ '--card-color': color } as React.CSSProperties}
    >
      <div
        className="absolute top-0 start-0 end-0 h-[20%]"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)` }}
      />
      <div className="absolute top-0 start-0 end-0 h-[20%] flex items-center justify-between px-2 py-1">
        {centerLogo ? (
          <img src={centerLogo} alt="" className="h-5 w-5 object-contain" />
        ) : (
          <div
            className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold"
            style={{ backgroundColor: color }}
          >
            {initials}
          </div>
        )}
        <span className="text-[10px] font-medium truncate" style={{ color: headerTextColor }}>
          {centerName}
        </span>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-[12%]">
        <div className="w-16 h-16 bg-[var(--color-surface-1)] rounded flex items-center justify-center border-2 border-[var(--color-border-subtle)] overflow-hidden">
          {qrCode ? (
            <img src={qrCode} alt="QR Code" className="w-full h-full object-contain" />
          ) : (
            <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">QR</span>
          )}
        </div>
        <div className="mt-1 text-xs font-bold text-[var(--color-text-primary)] truncate max-w-full px-1">{studentName}</div>
        <div className="text-[9px] font-mono truncate max-w-full px-1" style={{ color }}>
          {studentNumber}
        </div>
      </div>
    </div>
  );
}
