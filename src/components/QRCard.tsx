'use client';

import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

/** Professional ID card (85.6mm × 54mm). Used in print page and View QR modal. */

interface QRCardProps {
  student: { name: string; student_number?: string | null };
  qrDataUrl: string | null;
  centerLogo: string | null;
  centerName: string;
  /** Scale for screen preview (modal). 1 = print size. */
  scale?: number;
  className?: string;
  /** Modal/screen preview uses theme tokens; default keeps print-oriented gradient. */
  variant?: 'print' | 'preview';
}

export function QRCard({
  student,
  qrDataUrl,
  centerLogo,
  centerName,
  scale = 1,
  className = '',
  variant = 'print',
}: QRCardProps) {
  const w = 85.6;
  const h = 54;
  const qrSize = 21; // ~80px at print
  const qrContainerSize = 26; // 100px equivalent
  const isPreview = variant === 'preview';

  return (
    <div
      className={`relative overflow-hidden ${isPreview ? `text-[var(--color-text-primary)] rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-surface-1)] ${className}` : `text-white ${className}`}`}
      style={
        isPreview
          ? {
              width: `${w * scale}mm`,
              height: `${h * scale}mm`,
              minWidth: `${w * scale}mm`,
              minHeight: `${h * scale}mm`,
            }
          : {
              width: `${w * scale}mm`,
              height: `${h * scale}mm`,
              minWidth: `${w * scale}mm`,
              minHeight: `${h * scale}mm`,
              background: 'linear-gradient(135deg, var(--color-brand-500) 0%, var(--color-navy-800) 100%)',
            }
      }
    >
      {/* Top bar: semi-transparent dark strip */}
      <div
        className={`absolute top-0 start-0 end-0 flex items-center justify-between px-[3mm] py-[2.5mm] ${
          isPreview ? 'bg-[var(--color-surface-2)] border-b border-[var(--color-border)]' : ''
        }`}
        style={isPreview ? undefined : { background: 'rgba(0,0,0,0.35)' }}
      >
        {centerLogo ? (
          <img src={centerLogo} alt="" className="h-8 w-8 object-contain rounded shrink-0" />
        ) : null}
        <span
          className={`text-[11px] font-medium truncate max-w-[45mm] ${
            isPreview ? 'text-[var(--color-text-primary)]' : 'text-white'
          }`}
          style={{ fontSize: '11px' }}
        >
          {centerName || 'TutoringHQ'}
        </span>
      </div>

      {/* Center: QR on white rounded square */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="flex items-center justify-center rounded-lg shadow-lg"
          style={{
            width: `${qrContainerSize * scale}mm`,
            height: `${qrContainerSize * scale}mm`,
            background: '#fff',
            borderRadius: '8px',
          }}
        >
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR: ${student.name}`}
              style={{
                width: `${qrSize * scale}mm`,
                height: `${qrSize * scale}mm`,
              }}
            />
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          )}
        </div>
        <div
          className={`mt-[2.5mm] text-center font-bold leading-tight ${
            isPreview ? 'text-[var(--color-text-primary)]' : ''
          }`}
          style={{
            fontSize: `${14 * scale}px`,
            fontFamily: "'Cairo-Arabic', Georgia, \"Times New Roman\", serif",
          }}
        >
          {student.name}
        </div>
        <div
          className={`mt-[0.5mm] text-center font-mono ${
            isPreview ? 'text-[var(--color-text-muted)]' : ''
          }`}
          style={
            isPreview
              ? {
                  fontSize: `${10 * scale}px`,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                }
              : {
                  fontSize: `${10 * scale}px`,
                  opacity: 0.7,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                }
          }
        >
          {student.student_number != null && String(student.student_number).trim() !== ''
            ? formatStudentNumberForDisplay(student.student_number)
            : '-'}
        </div>
      </div>

      {/* Bottom: thin white line + TutoringHQ */}
      <div
        className={`absolute bottom-0 start-0 end-0 flex items-center justify-center py-[1.5mm] ${
          isPreview
            ? 'border-t border-[var(--color-border)] text-[var(--color-text-muted)]'
            : 'border-t border-white/20'
        }`}
      >
        <span
          className="font-mono"
          style={{
            fontSize: '7px',
            opacity: isPreview ? 0.8 : 0.3,
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          TutoringHQ
        </span>
      </div>
    </div>
  );
}
