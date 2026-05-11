'use client';

interface AnimatedPhoneMockupProps {
  locale: 'ar' | 'en';
}

/** Each slot height in the counter strip — must match the font metrics below. */
const ROW_H = 28;

/** Five values: 247→248→249→250→247 so the loop-back is seamless (same digit). */
const COUNTER_STEPS = ['247', '248', '249', '250', '247'];

const SCANS = {
  en: [
    { name: 'Ahmed Hassan', group: 'Group A', time: 'now' },
    { name: 'Sara Mohamed', group: 'Group B', time: '1m' },
    { name: 'Youssef Ali', group: 'Group A', time: '3m' },
    { name: 'Nour Ibrahim', group: 'Group C', time: '5m' },
  ],
  ar: [
    { name: 'أحمد حسن', group: 'مجموعة أ', time: 'الآن' },
    { name: 'سارة محمد', group: 'مجموعة ب', time: '١ د' },
    { name: 'يوسف علي', group: 'مجموعة أ', time: '٣ د' },
    { name: 'نور إبراهيم', group: 'مجموعة ج', time: '٥ د' },
  ],
};

const STATS = {
  en: [
    { v: '2,450', l: 'Today · EGP' },
    { v: '12', l: 'Active groups' },
    { v: '3', l: 'Pending' },
    { v: '47,200', l: 'Month · EGP' },
  ],
  ar: [
    { v: '٢,٤٥٠', l: 'إيراد اليوم ج.م' },
    { v: '١٢', l: 'مجموعات فعالة' },
    { v: '٣', l: 'معلق' },
    { v: '٤٧,٢٠٠', l: 'هذا الشهر ج.م' },
  ],
};

/**
 * Pure-CSS animated mobile mockup for the landing page hero.
 * All motion is driven by CSS @keyframes — zero JS timers, zero rerenders after mount.
 * Respects RTL via logical CSS properties; dark-mode aware via CSS variables.
 */
export function AnimatedPhoneMockup({ locale }: AnimatedPhoneMockupProps) {
  const isAr = locale === 'ar';
  const scans = SCANS[locale];
  const stats = STATS[locale];
  // Tilt inward toward the copy column: negative for LTR (phone on right), positive for RTL.
  const tilt = isAr ? '4deg' : '-4deg';
  // Cairo for Arabic; inherit system font for English.
  const fontFamily = isAr ? 'var(--font-cairo, Cairo, sans-serif)' : undefined;

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="relative w-full h-full"
      style={{ transform: `perspective(900px) rotateY(${tilt})`, willChange: 'transform' }}
    >
      {/* ── Keyframes injected once per render; component only mounts once on the landing page ── */}
      <style>{`
        @keyframes chq-counter-tick {
          0%       { transform: translateY(0px); }
          1.67%    { transform: translateY(-${ROW_H}px); }
          25%      { transform: translateY(-${ROW_H}px); }
          26.67%   { transform: translateY(-${ROW_H * 2}px); }
          50%      { transform: translateY(-${ROW_H * 2}px); }
          51.67%   { transform: translateY(-${ROW_H * 3}px); }
          75%      { transform: translateY(-${ROW_H * 3}px); }
          76.67%   { transform: translateY(-${ROW_H * 4}px); }
          99.999%  { transform: translateY(-${ROW_H * 4}px); }
        }
        /* Each scan row's glow occupies ~2.5% of the 12-second cycle (≈300ms).
           Rows are staggered by 3s (25%) via animation-delay. */
        @keyframes chq-scan-glow {
          0%, 8%, 100% { background-color: transparent; }
          2.5%          { background-color: rgba(13,148,136,0.13); }
        }
        @keyframes chq-dot-beat {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.25); opacity: 0.75; }
        }
        .chq-counter { animation: chq-counter-tick 12s linear infinite; }
        .chq-scan-1  { animation: chq-scan-glow 12s linear infinite 0s;  }
        .chq-scan-2  { animation: chq-scan-glow 12s linear infinite 3s;  }
        .chq-scan-3  { animation: chq-scan-glow 12s linear infinite 6s;  }
        .chq-scan-4  { animation: chq-scan-glow 12s linear infinite 9s;  }
        .chq-dot     { animation: chq-dot-beat 2s ease-in-out infinite;  }
      `}</style>

      {/* ── Phone outer frame ── */}
      <div
        className="absolute inset-0 rounded-[42px]"
        style={{
          background: 'linear-gradient(160deg, #2f3347 0%, #1c1f2e 50%, #0e1018 100%)',
          boxShadow: [
            '0 32px 96px rgba(0,0,0,0.75)',
            '0 0 52px rgba(13,148,136,0.18)',
            'inset 0 1px 0 rgba(255,255,255,0.07)',
            'inset 0 -1px 0 rgba(0,0,0,0.35)',
          ].join(', '),
        }}
      />

      {/* ── Screen area ── */}
      <div
        className="absolute overflow-hidden"
        style={{ inset: '7px', borderRadius: '35px', background: '#0b0e17' }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-0.5">
          <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 500 }}>9:41</span>
          <div className="flex gap-0.5 items-end">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="rounded-[1px] bg-slate-400"
                style={{ width: 3, height: 4 + n * 2 }}
              />
            ))}
            <div
              className="rounded-[2px] ms-1 overflow-hidden"
              style={{ width: 16, height: 8, border: '1px solid #64748b' }}
            >
              <div className="h-full bg-teal-400" style={{ width: '75%' }} />
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="px-3 pb-3 space-y-2.5" style={{ fontFamily }}>

          {/* Welcome + notification bell */}
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontSize: 7, color: '#64748b' }}>
                {isAr ? 'مساء الخير' : 'Good evening'}
              </p>
              <p style={{ fontSize: 10, fontWeight: 600, color: '#f1f5f9' }}>
                {isAr ? 'محمد أحمد' : 'Mohamed Ahmed'}
              </p>
            </div>
            <div
              className="relative flex items-center justify-center rounded-full"
              style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.05)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span
                className="absolute top-0.5 end-0.5 rounded-full chq-dot"
                style={{ width: 7, height: 7, background: '#2dd4bf', display: 'block' }}
              />
            </div>
          </div>

          {/* Attendance card */}
          <div
            className="rounded-xl p-2.5"
            style={{
              background: 'linear-gradient(135deg, rgba(13,148,136,0.22) 0%, rgba(13,148,136,0.06) 100%)',
              border: '1px solid rgba(13,148,136,0.28)',
            }}
          >
            <p style={{ fontSize: 7, color: '#5eead4', marginBottom: 6 }}>
              {isAr ? 'طلاب حضروا اليوم' : 'Students attended today'}
            </p>
            <div className="flex items-end gap-1.5">
              {/* Animated tick counter — pure CSS slot machine */}
              <div className="overflow-hidden" style={{ height: ROW_H }}>
                <div className="chq-counter">
                  {COUNTER_STEPS.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center"
                      style={{ height: ROW_H, fontSize: 22, fontWeight: 700, color: '#f8fafc', lineHeight: 1 }}
                    >
                      {v}
                    </div>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: 7, color: '#475569', marginBottom: 3 }}>
                / 310 {isAr ? 'متوقع' : 'expected'}
              </p>
            </div>
            <div
              className="rounded-full overflow-hidden mt-1.5"
              style={{ height: 4, background: 'rgba(255,255,255,0.08)' }}
            >
              <div className="h-full rounded-full" style={{ width: '80%', background: '#14b8a6' }} />
            </div>
            <p style={{ fontSize: 6, color: '#475569', marginTop: 3 }}>80%</p>
          </div>

          {/* Recent scans list */}
          <div>
            <p style={{ fontSize: 7, color: '#64748b', marginBottom: 4 }}>
              {isAr ? 'آخر الحضور' : 'Recent scans'}
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
              {scans.map((scan, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 px-2 py-1.5 chq-scan-${i + 1}`}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                  }}
                >
                  <div
                    className="flex items-center justify-center shrink-0 rounded-full"
                    style={{ width: 18, height: 18, background: 'rgba(20,184,166,0.22)' }}
                  >
                    <span style={{ fontSize: 7, color: '#5eead4', fontWeight: 700 }}>
                      {scan.name.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: 7, fontWeight: 500, color: '#e2e8f0' }}>
                      {scan.name}
                    </p>
                    <p style={{ fontSize: 6, color: '#475569' }}>{scan.group}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <svg width="9" height="9" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="8" fill="rgba(20,184,166,0.28)" />
                      <path d="M5 8.5l2 2 4-4" stroke="#14b8a6" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                    <span style={{ fontSize: 6, color: '#475569' }}>{scan.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats grid — 2×2 */}
          <div className="grid grid-cols-2 gap-1.5">
            {stats.map((stat, i) => (
              <div
                key={i}
                className="rounded-lg p-2"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9' }}>{stat.v}</p>
                <p style={{ fontSize: 6, color: '#475569', marginTop: 2 }}>{stat.l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Dynamic Island notch ── */}
      <div
        className="absolute"
        style={{
          insetInlineStart: 'calc(50% - 30px)',
          top: 10,
          width: 60,
          height: 16,
          background: '#0b0e17',
          borderRadius: 10,
        }}
      />

      {/* ── Home indicator bar ── */}
      <div
        className="absolute"
        style={{
          insetInlineStart: 'calc(50% - 40px)',
          bottom: 10,
          width: 80,
          height: 4,
          background: 'rgba(255,255,255,0.22)',
          borderRadius: 2,
        }}
      />
    </div>
  );
}
