'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CardTemplatePreviewProps {
  centerName: string;
  centerLogo: string | null;
  studentName: string;
  studentNumber: string;
  color?: string;
  className?: string;
}

export default function CardTemplatePreview({
  centerName,
  centerLogo,
  studentName,
  studentNumber,
  color = '#0D9488',
  className,
}: CardTemplatePreviewProps) {
  const initials = centerName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className={cn('relative w-48 aspect-[85.6/54] rounded-xl overflow-hidden shadow-lg border border-border bg-white', className)}
      style={{ '--card-color': color } as React.CSSProperties}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[20%]"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)` }}
      />
      <div className="absolute top-0 left-0 right-0 h-[20%] flex items-center justify-between px-2 py-1">
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
        <span className="text-white text-[10px] font-medium truncate">{centerName}</span>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-[12%]">
        <div className="w-16 h-16 bg-white rounded flex items-center justify-center border-2 border-slate-200">
          <span className="text-[10px] font-mono text-slate-500">QR</span>
        </div>
        <div className="mt-1 text-xs font-bold text-slate-900 truncate max-w-full px-1">{studentName}</div>
        <div className="text-[9px] font-mono truncate max-w-full px-1" style={{ color }}>{studentNumber}</div>
      </div>
    </div>
  );
}
