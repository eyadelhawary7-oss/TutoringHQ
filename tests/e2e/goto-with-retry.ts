import type { Page } from '@playwright/test';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Chrome can throw these when the OS network stack flaps (Wi‑Fi, VPN, parallel tabs). */
const TRANSIENT_NAV_FAILURE =
  /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_ABORTED/i;

/**
 * `page.goto` with a few retries on transient network errors so smoke tests stay stable locally and in CI.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1],
): Promise<Awaited<ReturnType<Page['goto']>>> {
  const attempts = 4;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await page.goto(url, {
        ...options,
        timeout: options?.timeout ?? 60_000,
        waitUntil: options?.waitUntil ?? 'load',
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!TRANSIENT_NAV_FAILURE.test(msg) || i === attempts - 1) {
        throw e;
      }
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}
