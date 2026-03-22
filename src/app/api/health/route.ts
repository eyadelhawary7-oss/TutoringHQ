/**
 * Comprehensive health check for pre-launch verification and uptime monitoring.
 * Public, no auth. Runs checks in parallel with 2.5s timeout each.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const CHECK_TIMEOUT_MS = 2500;
const REQUIRED_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'CEO_PHONE',
] as const;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function checkDatabase(): Promise<
  { status: 'ok' | 'fail'; latency_ms: number; error?: string }
> {
  const start = Date.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return { status: 'fail', latency_ms: Date.now() - start, error: 'Missing Supabase config' };
    }
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const result = await withTimeout(
      Promise.resolve(supabase.from('centers').select('id').limit(1).maybeSingle()) as Promise<{ error?: { message: string } }>,
      CHECK_TIMEOUT_MS
    );
    const error = result.error;
    const latency_ms = Date.now() - start;
    if (error) {
      return { status: 'fail', latency_ms, error: error.message };
    }
    return { status: 'ok', latency_ms };
  } catch (err) {
    return {
      status: 'fail',
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkAuth(): Promise<{ status: 'ok' | 'fail'; error?: string }> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return { status: 'fail', error: 'Missing Supabase auth config' };
    }
    const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
    const authResult = await withTimeout(
      supabase.auth.getSession() as Promise<{ error?: { message: string } }>,
      CHECK_TIMEOUT_MS
    );
    const authError = authResult.error;
    if (authError) {
      return { status: 'fail', error: authError.message };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkStorage(): Promise<{ status: 'ok' | 'fail'; error?: string }> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return { status: 'fail', error: 'Missing Supabase config' };
    }
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const storageResult = await withTimeout(
      Promise.resolve(supabase.storage.listBuckets()) as Promise<{ error?: { message: string } }>,
      CHECK_TIMEOUT_MS
    );
    const storageError = storageResult.error;
    if (storageError) {
      return { status: 'fail', error: storageError.message };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }
}

function checkEnvVars(): { status: 'ok' | 'fail'; missing: string[] } {
  const missing = REQUIRED_ENV_KEYS.filter((k) => {
    const v = process.env[k];
    return !v || String(v).trim() === '';
  });
  return {
    status: missing.length === 0 ? 'ok' : 'fail',
    missing,
  };
}

async function checkWhatsApp(): Promise<{ status: 'ok' | 'fail'; error?: string }> {
  try {
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!phoneId || !token) {
      return { status: 'fail', error: 'Missing WHATSAPP_PHONE_ID or WHATSAPP_TOKEN' };
    }
    const res = await withTimeout(
      fetch(`https://graph.facebook.com/v19.0/${phoneId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      CHECK_TIMEOUT_MS
    );
    if (!res.ok) {
      const text = await res.text();
      return { status: 'fail', error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const timestamp = new Date().toISOString();

  const [dbResult, authResult, storageResult, whatsappResult] = await Promise.allSettled([
    checkDatabase(),
    checkAuth(),
    checkStorage(),
    checkWhatsApp(),
  ]);

  const database =
    dbResult.status === 'fulfilled'
      ? dbResult.value
      : { status: 'fail' as const, latency_ms: 0, error: dbResult.reason instanceof Error ? dbResult.reason.message : String(dbResult.reason ?? 'Unknown error') };

  const auth =
    authResult.status === 'fulfilled'
      ? authResult.value
      : { status: 'fail' as const, error: authResult.reason instanceof Error ? authResult.reason.message : String(authResult.reason ?? 'Unknown error') };

  const storage =
    storageResult.status === 'fulfilled'
      ? storageResult.value
      : { status: 'fail' as const, error: storageResult.reason instanceof Error ? storageResult.reason.message : String(storageResult.reason ?? 'Unknown error') };

  const env_vars = checkEnvVars();

  const whatsapp =
    whatsappResult.status === 'fulfilled'
      ? whatsappResult.value
      : { status: 'fail' as const, error: whatsappResult.reason instanceof Error ? whatsappResult.reason.message : String(whatsappResult.reason ?? 'Unknown error') };

  const checks = {
    database,
    auth,
    storage,
    env_vars,
    whatsapp,
  };

  const failCount = [
    database.status,
    auth.status,
    storage.status,
    env_vars.status,
    whatsapp.status,
  ].filter((s) => s === 'fail').length;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (database.status === 'fail') {
    status = 'unhealthy';
  } else if (failCount >= 3) {
    status = 'unhealthy';
  } else if (failCount >= 1) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const httpStatus = status === 'healthy' ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp,
      checks,
    },
    { status: httpStatus }
  );
}
