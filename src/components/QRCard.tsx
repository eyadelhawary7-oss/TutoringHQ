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
          <img
            src={centerLogo}
            alt=""
            className="w-6 h-6 object-contain shrink-0"
            style={{ width: 24, height: 24 }}
          />
        ) : (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black text-white shrink-0"
            style={{ background: '#0D9488' }}
          >
            CH
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
            fontFamily: 'var(--font-cairo), sans-serif',
          }}
        >
          {student.name}
        </div>
        <div
          className="mt-[0.5mm] text-center font-mono"
          style={{
            fontSize: `${10 * scale}px`,
            opacity: 0.7,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
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
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          CenterHQ
        </span>
      </div>
    </div>
  );
}
