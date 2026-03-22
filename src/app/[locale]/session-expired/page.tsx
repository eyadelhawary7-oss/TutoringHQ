import { Link } from '@/i18n/routing';

export default function SessionExpiredPage() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <div className="w-16 h-16 rounded-full bg-[rgba(245,158,11,0.12)] flex items-center justify-center">
        <svg
          width="28"
          height="28"
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">انتهت الجلسة</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Session expired — please log in again</p>
      </div>
      <Link href="/login" className="btn btn-primary">
        تسجيل الدخول
      </Link>
    </div>
  );
}
