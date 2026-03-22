import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        margin: 0,
        background: '#080f1a',
        color: '#f8fafc',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 400 }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: '#0D9488', lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '1rem 0 0.5rem', color: '#f8fafc' }}>
          الصفحة غير موجودة
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: '1.5rem' }}>Page not found</p>
        <Link
          href="/ar/dashboard"
          style={{
            display: 'inline-block',
            background: '#0D9488',
            color: '#fff',
            padding: '0.625rem 1.5rem',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
