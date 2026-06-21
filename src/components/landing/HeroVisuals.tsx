'use client';

import { AnimatedPhoneMockup } from '@/components/landing/AnimatedPhoneMockup';

interface HeroVisualsProps {
  locale: 'ar' | 'en';
}

const DASHBOARD_STATS = {
  en: [
    { v: '47,200', l: 'MRR (EGP)' },
    { v: '12', l: 'Active ctrs' },
    { v: '3', l: 'Pending inv.' },
  ],
  ar: [
    { v: '٤٧,٢٠٠', l: 'الإيراد ج.م' },
    { v: '١٢', l: 'سنتر فعال' },
    { v: '٣', l: 'فواتير معلقة' },
  ],
} as const;

/**
 * Hero visual composition: laptop admin dashboard (behind) + animated phone
 * (center) + WhatsApp parent notification card (front).
 *
 * On mobile/md the supporting elements are hidden - only the phone is shown,
 * matching the original single-phone layout.
 */
export function HeroVisuals({ locale }: HeroVisualsProps) {
  const isAr = locale === 'ar';
  const stats = DASHBOARD_STATS[locale];
  const waMsg = isAr
    ? 'أحمد حضر حصة اللغة الإنجليزية اليوم في 4:32 م ✓'
    : 'Ahmed attended English class today at 4:32 PM ✓';

  return (
    <>
      <style>{`
        @keyframes chq-wa-fadein {
          0%   { opacity: 0;   transform: translateY(8px); }
          18%  { opacity: 1;   transform: translateY(0);   }
          72%  { opacity: 1;   transform: translateY(0);   }
          92%  { opacity: 0.2; transform: translateY(5px); }
          100% { opacity: 0;   transform: translateY(8px); }
        }
        .chq-wa-card { animation: chq-wa-fadein 8s ease-in-out infinite; }
      `}</style>

      {/* ── Mobile / md: phone only (original layout) ── */}
      <div
        className="relative mx-auto shrink-0 drop-shadow-[0_0_80px_rgba(13,148,136,0.2)] lg:hidden"
        style={{ width: 280, height: 560 }}
      >
        <AnimatedPhoneMockup locale={locale} />
      </div>

      {/* ── lg+: full three-element composition ── */}
      <div
        className="relative hidden shrink-0 lg:block"
        style={{ width: 520, height: 560 }}
      >
        {/* ── Laptop frame ── */}
        <div
          className="absolute"
          style={{
            insetInlineStart: '5%',
            top: '8%',
            width: 258,
            zIndex: 1,
            transform: 'rotateZ(-3deg)',
            transformOrigin: 'top center',
          }}
        >
          {/* Screen lid */}
          <div
            style={{
              background: 'linear-gradient(160deg, #2d3248 0%, #1a1d2b 100%)',
              borderRadius: '8px 8px 0 0',
              padding: 6,
              boxShadow:
                '0 0 0 1px rgba(255,255,255,0.07), 0 16px 48px rgba(0,0,0,0.55)',
            }}
          >
            <div
              style={{ background: '#0a0d14', borderRadius: 3, overflow: 'hidden' }}
            >
              {/* Title bar */}
              <div
                style={{
                  background: 'rgba(13,148,136,0.14)',
                  borderBottom: '1px solid rgba(13,148,136,0.18)',
                  padding: '5px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 3,
                    marginInlineEnd: 'auto',
                  }}
                >
                  {(['#ef4444', '#f59e0b', '#22c55e'] as const).map((c) => (
                    <div
                      key={c}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: c,
                      }}
                    />
                  ))}
                </div>
                <span
                  style={{
                    fontSize: 6,
                    color: '#5eead4',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  TutoringHQ
                </span>
                <span style={{ fontSize: 6, color: '#475569' }}>
                  {isAr ? '· لوحة التحكم' : '· Admin'}
                </span>
              </div>

              {/* Screen content */}
              <div style={{ padding: '6px 8px 8px' }}>
                {/* Sparkline chart */}
                <p
                  style={{ fontSize: 5, color: '#64748b', margin: '0 0 3px' }}
                >
                  {isAr ? 'الإيراد الشهري' : 'Monthly revenue (EGP)'}
                </p>
                <svg
                  width="100%"
                  height="44"
                  viewBox="0 0 180 58"
                  preserveAspectRatio="none"
                  style={{ display: 'block', marginBottom: 6 }}
                >
                  <defs>
                    <linearGradient
                      id="chq-spark-grad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#0d9488"
                        stopOpacity="0.28"
                      />
                      <stop
                        offset="100%"
                        stopColor="#0d9488"
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,52 C30,48 50,44 70,40 S110,28 130,22 S160,12 180,6"
                    fill="none"
                    stroke="#14b8a6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M0,52 C30,48 50,44 70,40 S110,28 130,22 S160,12 180,6 L180,58 L0,58 Z"
                    fill="url(#chq-spark-grad)"
                  />
                  <circle cx="180" cy="6" r="3" fill="#14b8a6" />
                </svg>

                {/* Stat tiles row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 4,
                  }}
                >
                  {stats.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 4,
                        padding: '4px 5px',
                      }}
                    >
                      <p
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: '#f1f5f9',
                          margin: 0,
                        }}
                      >
                        {s.v}
                      </p>
                      <p
                        style={{
                          fontSize: 5,
                          color: '#475569',
                          margin: '1px 0 0',
                        }}
                      >
                        {s.l}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Keyboard deck */}
          <div
            style={{
              background: 'linear-gradient(180deg, #3a3f58 0%, #1c1f2e 100%)',
              borderRadius: '0 0 3px 3px',
              height: 12,
              marginInline: '-3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 0 rgba(0,0,0,0.4)',
            }}
          >
            {/* Touchpad hint */}
            <div
              style={{
                width: 38,
                height: 5,
                background: 'rgba(255,255,255,0.07)',
                borderRadius: 2,
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            />
          </div>
          {/* Base foot */}
          <div
            style={{
              height: 5,
              marginInline: '10px',
              background: 'linear-gradient(180deg, #1c1f2e 0%, #141622 100%)',
              borderRadius: '0 0 5px 5px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
            }}
          />
        </div>

        {/* ── Phone (centerpiece) ── */}
        <div
          className="absolute drop-shadow-[0_0_80px_rgba(13,148,136,0.2)]"
          style={{
            insetInlineStart: '34%',
            top: 0,
            width: 280,
            height: 560,
            zIndex: 2,
          }}
        >
          <AnimatedPhoneMockup locale={locale} />
        </div>

        {/* ── WhatsApp notification card ── */}
        {/* Rotation wrapper (static) + fade-in animated inner */}
        <div
          className="absolute"
          style={{
            insetInlineEnd: '2%',
            bottom: '12%',
            zIndex: 3,
            transform: 'rotateZ(2deg)',
          }}
        >
          <div
            className="chq-wa-card"
            style={{
              width: 175,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow:
                '0 8px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            {/* WA header bar */}
            <div
              style={{
                background: '#075E54',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#128C7E',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                C
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    color: '#fff',
                    margin: 0,
                  }}
                >
                  TutoringHQ
                </p>
                <p style={{ fontSize: 6, color: '#b2dfdb', margin: 0 }}>
                  WhatsApp Business
                </p>
              </div>
              {/* Double-tick read receipt */}
              <svg
                width="14"
                height="10"
                viewBox="0 0 18 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 6l4 4L10 2"
                  stroke="#34D399"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 6l4 4L18 2"
                  stroke="#34D399"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Message bubble */}
            <div style={{ background: '#ECE5DD', padding: '8px 10px' }}>
              <div
                dir={isAr ? 'rtl' : 'ltr'}
                style={{
                  background: '#fff',
                  borderRadius: isAr ? '8px 0 8px 8px' : '0 8px 8px 8px',
                  padding: '6px 8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                }}
              >
                <p
                  style={{
                    fontSize: 7.5,
                    color: '#111',
                    lineHeight: 1.45,
                    margin: 0,
                  }}
                >
                  {waMsg}
                </p>
                <p
                  style={{
                    fontSize: 6,
                    color: '#667781',
                    textAlign: 'end',
                    margin: '3px 0 0',
                  }}
                >
                  4:32 PM
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
