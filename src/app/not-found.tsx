import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { colors } from '@/lib/tokens';

export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <div
      style={{
        margin: 0,
        background: colors.navy[950],
        color: colors.navy[50],
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 400 }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: colors.brand[500], lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '1rem 0 0.5rem', color: colors.navy[50] }}>{t('heading')}</h1>
        <p style={{ color: colors.navy[400], fontSize: 14, marginBottom: '1.5rem' }}>{t('subtitle')}</p>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-block',
            background: colors.brand[500],
            color: '#fff',
            padding: '0.625rem 1.5rem',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {t('backHome')}
        </Link>
      </div>
    </div>
  );
}
