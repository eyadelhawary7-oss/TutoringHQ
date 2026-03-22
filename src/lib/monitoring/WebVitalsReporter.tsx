'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { reportWebVitals } from './vitals';

/**
 * Client component that reports LCP, FCP, CLS, TTFB, FID, INP to Vercel Analytics.
 * Renders nothing; keep in root layout for minimal client boundary.
 */
export default function WebVitalsReporter() {
  useReportWebVitals(reportWebVitals);
  return null;
}
