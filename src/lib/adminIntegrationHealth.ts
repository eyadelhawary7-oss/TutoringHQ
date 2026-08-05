/**
 * `Merged-Admin-Platform` §03 — the vendors frame, over the health data that
 * actually exists.
 *
 * WHAT THE DESIGN DRAWS vs WHAT IS LIVE
 * -------------------------------------
 * §03 draws an INTEGRATIONS list of four outside services (Paymob, Valify,
 * WhatsApp API, SMS gateway) each with a connection state, then a PAYMOB DETAIL
 * card with Status, Last check, Success rate 24h and Merchant ID.
 *
 * The live equivalent is `status_checks` — written every five minutes by
 * `/api/cron/status-ping`, verified live on 4 August 2026 as columns
 * `id, service, status, response_time_ms, checked_at` carrying 9,179 rows for
 * each of exactly three services: `api`, `payments`, `scanner`. That is enough
 * for the design's row shape (name, purpose, state dot) and for three of the
 * four PAYMOB DETAIL fields.
 *
 * DELIBERATELY NOT RENDERED, each with its cause:
 *  - **Valify** — V1. No credential exists on any deployment and nothing pings
 *    it. The design's "Valify · Connected" green dot is a design-side
 *    fabrication; drawing it would assert a live integration that does not
 *    exist.
 *  - **SMS gateway** — no pinger, no `status_checks.service` row, no column.
 *  - **WhatsApp API as a health row** — `status_checks` has no `whatsapp`
 *    service. `/admin/health` reports a live/test MODE, which is a
 *    configuration flag, not a reachability check; presenting it as
 *    "Connected" would conflate the two.
 *  - **Merchant ID** — a Paymob credential read from the environment, not a
 *    column. It is not surfaced.
 *
 * The three services that ARE pinged are named for what they are rather than
 * relabelled onto the design's vendor names: `payments` pings the app's own
 * `/api/health`, not Paymob's API, so calling that row "Paymob" would report
 * Paymob's health from a probe that never touches Paymob.
 */

/** The services `/api/cron/status-ping` actually writes. Nothing else is invented. */
export const PINGED_SERVICES = ['api', 'payments', 'scanner'] as const;
export type PingedService = (typeof PINGED_SERVICES)[number];

export interface StatusCheckRow {
  service: string;
  status: string;
  response_time_ms: number | null;
  checked_at: string;
}

export interface IntegrationHealthView {
  service: PingedService;
  /** Latest ping's status, or `unknown` when the service has never been pinged. */
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  /**
   * Share of the last 24 hours' pings that came back operational, 0–100, or
   * null when there were no pings in the window. Null is NOT zero: "we did not
   * measure" and "it failed every time" are opposite facts.
   */
  successRate24h: number | null;
  checks24h: number;
}

function normalizeStatus(raw: string): IntegrationHealthView['status'] {
  if (raw === 'operational' || raw === 'degraded' || raw === 'outage') return raw;
  return 'unknown';
}

/**
 * Fold raw `status_checks` rows into one view per pinged service.
 *
 * `rows` may arrive in any order; the latest `checked_at` per service wins.
 * The 24-hour window is measured back from `now`, not from the newest row —
 * a stale feed must show a shrinking sample, not a full one frozen in time.
 */
export function buildIntegrationHealth(
  rows: StatusCheckRow[],
  now: Date = new Date(),
): IntegrationHealthView[] {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;

  return PINGED_SERVICES.map((service) => {
    const forService = rows.filter((r) => r.service === service);

    let latest: StatusCheckRow | null = null;
    let ok24 = 0;
    let n24 = 0;

    for (const row of forService) {
      const ts = new Date(row.checked_at).getTime();
      if (Number.isNaN(ts)) continue;
      if (!latest || ts > new Date(latest.checked_at).getTime()) latest = row;
      if (ts >= cutoff && ts <= now.getTime()) {
        n24 += 1;
        if (row.status === 'operational') ok24 += 1;
      }
    }

    return {
      service,
      status: latest ? normalizeStatus(latest.status) : 'unknown',
      lastCheckedAt: latest?.checked_at ?? null,
      lastResponseMs: latest?.response_time_ms ?? null,
      successRate24h: n24 > 0 ? Math.round((ok24 / n24) * 100) : null,
      checks24h: n24,
    };
  });
}
