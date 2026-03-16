import { track } from '@vercel/analytics/react';

export type WebVitalMetric = {
  id: string;
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
};

/**
 * Reports Core Web Vitals (LCP, FCP, CLS, TTFB, FID, INP) to Vercel Analytics.
 * Used by WebVitalsReporter client component via useReportWebVitals.
 */
export function reportWebVitals(metric: WebVitalMetric): void {
  track('web-vital', {
    name: metric.name,
    value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  });
}
