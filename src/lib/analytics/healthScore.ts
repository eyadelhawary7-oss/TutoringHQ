/**
 * Center health score (0-100) — computed in SQL, stored in centers.health_score
 * Recomputed nightly via pg_cron → recompute_all_health_scores()
 *
 * Components:
 * - Last scan activity: 0 scans/7 days = -30
 * - Onboarding complete: +20
 * - Payment current: +25
 * - Parent comms enabled: +10
 * - Daily summary on: +5
 * - Referral sent: +10
 *
 * Bands: 80-100=Healthy, 60-79=Engaged, 40-59=At Risk, 0-39=Critical
 */

export type HealthBand = 'Healthy' | 'Engaged' | 'At Risk' | 'Critical';

export const HEALTH_BANDS: { band: HealthBand; min: number; max: number }[] = [
  { band: 'Healthy', min: 80, max: 100 },
  { band: 'Engaged', min: 60, max: 79 },
  { band: 'At Risk', min: 40, max: 59 },
  { band: 'Critical', min: 0, max: 39 },
];

export function getBandFromScore(score: number): HealthBand {
  if (score >= 80) return 'Healthy';
  if (score >= 60) return 'Engaged';
  if (score >= 40) return 'At Risk';
  return 'Critical';
}

export function getBandColor(band: HealthBand): string {
  switch (band) {
    case 'Healthy':
      return '#10b981';
    case 'Engaged':
      return '#0d9488';
    case 'At Risk':
      return '#f59e0b';
    case 'Critical':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}
