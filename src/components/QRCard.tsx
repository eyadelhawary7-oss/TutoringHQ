'use client';

/**
 * Professional ID card component (85.6mm × 54mm credit-card proportions).
 * Used in print page and View QR modal.
 */
interface QRCardProps {
  student: { name: string; student_number?: string | null };
  qrDataUrl: string | null;
  centerLogo: string | null;
  centerName: string;
  /** Scale for screen preview (modal). 1 = print size. */
  scale?: number;
  className?: string;
}

export function QRCard({
  student,
  qrDataUrl,
  centerLogo,
  centerName,
  scale = 1,
  className = '',
}: QRCardProps) {
  const w = 85.6;
  const h = 54;
  const qrSize = 21; // ~80px at print
  const qrContainerSize = 26; // 100px equivalent

  return (
    <div
      className={`relative overflow-hidden text-white ${className}`}
      style={{
        width: `${w * scale}mm`,
        height: `${h * scale}mm`,
        minWidth: `${w * scale}mm`,
        minHeight: `${h * scale}mm`,
        background: 'linear-gradient(135deg, #0D9488 0%, #1E293B 100%)',
      }}
    >
      {/* Top bar: semi-transparent dark strip */}
      <div
        className="absolute top-0 start-0 end-0 flex items-center justify-between px-[3mm] py-[2.5mm]"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      >
        {centerLogo ? (
          <img src={centerLogo} alt="" className="h-8 w-8 object-contain rounded shrink-0" />
        ) : (
          <div className="h-8 w-8 bg-[var(--color-surface-1)]/20 rounded flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">CH</span>
          </div>
        )}
        <span className="text-[11px] font-medium text-white truncate max-w-[45mm]" style={{ fontSize: '11px' }}>
          {centerName || 'CenterHQ'}
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
          className="mt-[2.5mm] text-center font-bold leading-tight"
          style={{
            fontSize: `${14 * scale}px`,
            fontFamily: "'Cairo-Arabic', Georgia, \"Times New Roman\", serif",
          }}
        >
          {student.name}
        </div>
        <div
          className="mt-[0.5mm] text-center font-mono"
          style={{
            fontSize: `${10 * scale}px`,
            opacity: 0.7,
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          {student.student_number || '—'}
        </div>
      </div>

      {/* Bottom: thin white line + CenterHQ */}
      <div className="absolute bottom-0 start-0 end-0 flex items-center justify-center border-t border-white/20 py-[1.5mm]">
        <span
          className="font-mono"
          style={{
            fontSize: '7px',
            opacity: 0.3,
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          CenterHQ
        </span>
      </div>
    </div>
  );
}
