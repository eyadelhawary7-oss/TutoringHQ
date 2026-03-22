'use client';

export default function OfflinePage() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <div className="w-20 h-20 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center">
        <svg
          width="40"
          height="40"
          fill="none"
          stroke="var(--color-text-tertiary)"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
        </svg>
      </div>
      <div className="text-center">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">أنت غير متصل</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">تحقق من اتصالك بالإنترنت وحاول مجدداً</p>
      </div>
      <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
        إعادة المحاولة
      </button>
    </div>
  );
}
