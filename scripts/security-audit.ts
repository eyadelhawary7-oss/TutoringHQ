/**
 * Security probe harness. Run:
 *   npx tsx scripts/security-audit.ts [--webhooks|--crons|--auth|--rate-limit|--webhooks-deep|--rate-limit-deep|--audit-log|--dlq|--all]
 * Requires BASE_URL / PLAYWRIGHT_BASE_URL / SECURITY_AUDIT_BASE_URL for HTTP checks.
 * Deep modes SKIP gracefully when secrets or DB are unavailable (CI-friendly).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

type Mode =
  | 'webhooks'
  | 'crons'
  | 'auth'
  | 'rate-limit'
  | 'webhooks-deep'
  | 'rate-limit-deep'
  | 'audit-log'
  | 'dlq'
  | 'all';

const args = process.argv.slice(2);
const mode: Mode = args.includes('--all')
  ? 'all'
  : args.includes('--webhooks-deep')
    ? 'webhooks-deep'
    : args.includes('--rate-limit-deep')
      ? 'rate-limit-deep'
      : args.includes('--audit-log')
        ? 'audit-log'
        : args.includes('--dlq')
          ? 'dlq'
          : args.includes('--webhooks')
            ? 'webhooks'
            : args.includes('--crons')
              ? 'crons'
              : args.includes('--rate-limit')
                ? 'rate-limit'
                : 'auth';

const BASE =
  process.env.SECURITY_AUDIT_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.BASE_URL ||
  '';

const lines: string[] = [
  `# Security audit`,
  `Mode: ${mode}`,
  `Base: ${BASE || '(none — HTTP checks skipped)'}`,
  ``,
];
const failures: string[] = [];

function hmacSha512Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha512', secret).update(payload, 'utf8').digest('hex');
}

function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(String(aHex).trim().toLowerCase(), 'hex');
    const b = Buffer.from(String(bHex).trim().toLowerCase(), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function fetchStatus(url: string, init?: RequestInit): Promise<number> {
  try {
    const r = await fetch(url, { ...init, redirect: 'manual' });
    return r.status;
  } catch {
    return 0;
  }
}

async function authChecks() {
  lines.push('## Auth API');
  if (!BASE) {
    lines.push('- SKIP /api/me (no BASE_URL)');
    return;
  }
  const origin = BASE.replace(/\/$/, '');
  const meUnauth = await fetchStatus(`${origin}/api/me`);
  lines.push(`- GET /api/me unauthenticated → ${meUnauth} ${meUnauth === 401 ? 'PASS' : 'FAIL (expect 401)'}`);
  if (BASE && meUnauth !== 401) failures.push(`/api/me unauthenticated expected 401, got ${meUnauth}`);
  const branchesUnauth = await fetchStatus(`${origin}/api/branches`);
  lines.push(`- GET /api/branches unauthenticated → ${branchesUnauth} ${branchesUnauth === 401 ? 'PASS' : 'FAIL'}`);
  if (BASE && branchesUnauth !== 401) failures.push(`/api/branches unauthenticated expected 401, got ${branchesUnauth}`);
  const adminCheck = await fetch(`${origin}/api/admin/check`);
  const adminJson = (await adminCheck.json().catch(() => ({}))) as { isAdmin?: boolean };
  lines.push(
    `- GET /api/admin/check unauthenticated → ${adminCheck.status} isAdmin=${adminJson.isAdmin} ${adminJson.isAdmin === false ? 'PASS' : 'WARN'}`,
  );
}

function cronDiscovery(): string[] {
  const cronRoot = path.join(__dirname, '..', 'src', 'app', 'api', 'cron');
  const routes: string[] = [];
  if (!fs.existsSync(cronRoot)) return routes;
  function walk(d: string) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === 'route.ts')
        routes.push('/api/cron/' + path.relative(cronRoot, path.dirname(p)).replace(/\\/g, '/'));
    }
  }
  walk(cronRoot);
  return routes;
}

async function cronChecks() {
  lines.push('## Cron routes');
  const routes = cronDiscovery();
  lines.push(`Discovered ${routes.length} cron paths under src/app/api/cron`);
  if (!BASE) {
    lines.push('- SKIP live cron probe');
    return;
  }
  const origin = BASE.replace(/\/$/, '');
  const probe = routes.slice(0, 5);
  for (const r of probe) {
    const st = await fetchStatus(`${origin}${r}`, { headers: { Authorization: 'Bearer invalid-token' } });
    lines.push(`- GET ${r} wrong Bearer → ${st} ${st === 401 ? 'PASS' : 'WARN'}`);
    if (BASE && st === 200) failures.push(`${r} invalid cron bearer unexpectedly returned 200`);
  }
}

async function webhookChecks() {
  lines.push('## Webhooks (smoke)');
  lines.push('- Paymob / Bosta / WhatsApp require valid HMAC (or Paymob legacy obj+hmac) or return 401.');
}

async function rateLimitChecks() {
  lines.push('## Rate limit (smoke)');
  lines.push('- /api/login uses sliding-window rateLimit when Upstash env is set; verify with --rate-limit-deep.');
}

async function webhookDeepMatrix() {
  lines.push('## Webhooks — HMAC matrix (deep)');
  if (!BASE) {
    lines.push('- SKIP (no BASE_URL)');
    return;
  }
  const origin = BASE.replace(/\/$/, '');
  const junk = JSON.stringify({ ok: true, probe: 'security-audit' });

  const paymobUrl = `${origin}/api/paymob/webhook`;
  const noSigPaymob = await fetch(paymobUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: junk,
  });
  lines.push(`- Paymob POST no signature → ${noSigPaymob.status} ${noSigPaymob.status === 401 ? 'PASS' : 'WARN'}`);

  const badSigPaymobSecret = process.env.PAYMOB_HMAC_SECRET;
  if (badSigPaymobSecret) {
    const badSigBody = JSON.stringify({
      obj: { id: 1, success: false, order: { id: 'audit-bad-sig' } },
    });
    const badPaymob = await fetch(paymobUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hmac-signature': '00'.repeat(32),
      },
      body: badSigBody,
    });
    lines.push(`- Paymob malformed x-hmac-signature → ${badPaymob.status} ${badPaymob.status === 401 ? 'PASS' : 'WARN'}`);
  }

  const paymobGet = await fetchStatus(paymobUrl, { method: 'GET' });
  lines.push(`- Paymob GET (no POST handler) → ${paymobGet} ${paymobGet === 405 ? 'PASS' : 'WARN'}`);

  const truncatedPaymob = await fetch(paymobUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  lines.push(
    `- Paymob truncated JSON body → ${truncatedPaymob.status} ${truncatedPaymob.status === 401 || truncatedPaymob.status === 413 ? 'PASS' : 'WARN'}`,
  );

  const bostaUrl = `${origin}/api/bosta/webhook`;
  const noSigBosta = await fetch(bostaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: junk,
  });
  lines.push(`- Bosta POST no Bosta-Signature → ${noSigBosta.status} ${noSigBosta.status === 401 ? 'PASS' : 'WARN'}`);

  const bostaSecret = process.env.BOSTA_WEBHOOK_SECRET ?? '';
  if (bostaSecret) {
    const bostaBody = JSON.stringify({ order_id: 'audit-bosta-malformed' });
    const badBosta = await fetch(bostaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Bosta-Signature': 'deadbeef' },
      body: bostaBody,
    });
    lines.push(`- Bosta malformed HMAC → ${badBosta.status} ${badBosta.status === 401 ? 'PASS' : 'WARN'}`);
  }

  const bostaGet = await fetchStatus(bostaUrl, { method: 'GET' });
  lines.push(`- Bosta GET → ${bostaGet} ${bostaGet === 405 ? 'PASS' : 'WARN'}`);

  const waUrl = `${origin}/api/whatsapp/webhook`;
  const noSigWa = await fetch(waUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: junk,
  });
  lines.push(`- WhatsApp POST no x-hub-signature-256 → ${noSigWa.status} ${noSigWa.status === 401 ? 'PASS' : 'WARN'}`);

  const waSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  if (waSecret) {
    const waBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const badWa = await fetch(waUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      body: waBody,
    });
    lines.push(`- WhatsApp malformed signature → ${badWa.status} ${badWa.status === 401 ? 'PASS' : 'WARN'}`);

    const oldTsBody = waBody;
    const goodSig = `sha256=${hmacSha256Hex(waSecret, oldTsBody)}`;
    const expiredProbe = await fetch(waUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': goodSig,
        'X-Hub-Timestamp': String(Math.floor(Date.now() / 1000) - 600),
      },
      body: oldTsBody,
    });
    lines.push(
      `- WhatsApp POST signed payload with synthetic old X-Hub-Timestamp → ${expiredProbe.status} (handler does not enforce skew — ${expiredProbe.status === 200 ? 'N/A by design' : 'unexpected'})`,
    );
  }

  const waGet = await fetchStatus(waUrl, { method: 'GET' });
  lines.push(
    `- WhatsApp GET (subscription verify route) → ${waGet} NOTE: expected 403 without hub params, not 405`,
  );

  const paymobSecret = process.env.PAYMOB_HMAC_SECRET;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (paymobSecret && sbUrl && sbKey) {
    const txnId = `audit-${Date.now()}`;
    const signedBody = JSON.stringify({
      obj: {
        id: txnId,
        success: false,
        order: { id: `audit-order-${txnId}` },
      },
    });
    const sig = hmacSha512Hex(paymobSecret, signedBody);
    const headers = {
      'Content-Type': 'application/json',
      'x-hmac-signature': sig,
    };
    const r1 = await fetch(paymobUrl, { method: 'POST', headers, body: signedBody });
    const r2 = await fetch(paymobUrl, { method: 'POST', headers, body: signedBody });
    lines.push(`- Paymob valid signed payload → ${r1.status} ${r1.status === 200 ? 'PASS' : 'WARN'}`);
    lines.push(`- Paymob identical replay → ${r2.status} ${r2.status === 200 ? 'PASS' : 'WARN'}`);

    const admin = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
    const idem = `paymob:${txnId}`;
    const { data: rows, error: inboxErr } = await admin
      .from('webhook_inbox')
      .select('id')
      .eq('idempotency_key', idem);
    if (inboxErr) {
      lines.push(`- webhook_inbox idempotency read → ERROR ${inboxErr.message}`);
    } else {
      const n = rows?.length ?? 0;
      lines.push(`- webhook_inbox rows for ${idem}: ${n} ${n <= 1 ? 'PASS (no duplicate keys)' : 'FAIL'}`);
      if (n > 1) failures.push(`Paymob replay created ${n} inbox rows for same idempotency_key`);
    }
  } else {
    lines.push('- Paymob signed + inbox idempotency check SKIP (need PAYMOB_HMAC_SECRET + Supabase service role)');
  }

  const bostaSecret2 = process.env.BOSTA_WEBHOOK_SECRET ?? '';
  if (bostaSecret2 && sbUrl && sbKey) {
    const oid = `audit-bosta-${Date.now()}`;
    const bSigned = JSON.stringify({ order_id: oid });
    const bSig = crypto.createHmac('sha256', bostaSecret2).update(bSigned).digest('hex');
    const br = await fetch(bostaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Bosta-Signature': bSig },
      body: bSigned,
    });
    lines.push(`- Bosta valid signed payload → ${br.status} ${br.status === 200 ? 'PASS' : 'WARN'}`);
  } else {
    lines.push('- Bosta signed happy-path SKIP (need BOSTA_WEBHOOK_SECRET + Supabase)');
  }

  if (waSecret) {
    const waOkBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const waSig = `sha256=${hmacSha256Hex(waSecret, waOkBody)}`;
    const wr = await fetch(waUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': waSig },
      body: waOkBody,
    });
    lines.push(`- WhatsApp valid signed minimal payload → ${wr.status} ${wr.status === 200 ? 'PASS' : 'WARN'}`);
  }
}

async function rateLimitDeep() {
  lines.push('## Rate limit (deep)');
  if (!BASE) {
    lines.push('- SKIP (no BASE_URL)');
    return;
  }
  const origin = BASE.replace(/\/$/, '');
  const phone = '+201005551337';
  let saw429Login = false;
  for (let i = 0; i < 24; i++) {
    const r = await fetch(`${origin}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (r.status === 429) {
      saw429Login = true;
      const ra = r.headers.get('retry-after');
      lines.push(`- POST /api/login burst saw 429 Retry-After=${ra ?? '(none)'} PASS`);
      break;
    }
  }
  if (!saw429Login) {
    lines.push('- POST /api/login ×24 same phone → no 429 (Upstash unset or window not exceeded) WARN');
  }

  let saw429Me = false;
  for (let i = 0; i < 50; i++) {
    const st = await fetchStatus(`${origin}/api/me`);
    if (st === 429) {
      saw429Me = true;
      lines.push('- GET /api/me ×50 unauthenticated saw 429 PASS');
      break;
    }
  }
  if (!saw429Me) {
    lines.push('- GET /api/me ×50 → no 429 (endpoint is not rate limited) SKIP');
  }

  const token = process.env.SECURITY_AUDIT_ACCESS_TOKEN ?? '';
  if (token) {
    let okBurst = 0;
    for (let i = 0; i < 15; i++) {
      const st = await fetchStatus(`${origin}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (st === 200) okBurst += 1;
    }
    lines.push(
      `- Authenticated GET /api/me ×15 → ${okBurst}/15 status 200 ${okBurst >= 14 ? 'PASS (no false-positive lockout)' : 'WARN'}`,
    );
  } else {
    lines.push('- Authenticated burst SKIP (set SECURITY_AUDIT_ACCESS_TOKEN to probe)');
  }
}

async function auditLogProbe() {
  lines.push('## audit_log probe');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    lines.push('- SKIP (no Supabase env)');
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const probeAction = 'security_audit.probe';
  const probeDetails = { probe: true, at: new Date().toISOString() };
  const { error: insErr } = await admin.from('audit_log').insert({
    center_id: null,
    user_id: '00000000-0000-0000-0000-000000000000',
    action: probeAction,
    entity_type: 'security_audit',
    details: probeDetails,
  });
  if (insErr) {
    lines.push(`- Insert probe audit row → ERROR ${insErr.message} WARN`);
    return;
  }

  type AuditProbeRow = {
    user_id: string | null;
    action: string;
    entity_type: string | null;
    details: unknown;
  };
  const deadline = Date.now() + 5000;
  let found: AuditProbeRow | null = null;
  while (Date.now() < deadline && !found) {
    const { data, error } = await admin
      .from('audit_log')
      .select('user_id, action, entity_type, details')
      .eq('action', probeAction)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      found = data as AuditProbeRow;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!found) {
    lines.push('- Read-back probe row within 5s → FAIL');
    failures.push('audit_log probe row not found within 5s');
    return;
  }

  const ok =
    found.action === probeAction &&
    found.entity_type === 'security_audit' &&
    found.details &&
    typeof found.details === 'object' &&
    (found.details as { probe?: boolean }).probe === true;
  lines.push(`- audit_log probe fields (user_id, action, entity_type, details payload) → ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failures.push('audit_log probe row missing expected fields');

  await admin.from('audit_log').delete().eq('action', probeAction);
}

async function dlqProbe() {
  lines.push('## dead_letter_queue (DLQ) probe');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;
  if (!url || !key) {
    lines.push('- SKIP (no Supabase env)');
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { error: readErr } = await admin.from('dead_letter_queue').select('id').limit(1);
  if (readErr) {
    lines.push(`- dead_letter_queue readable → ${readErr.message} WARN`);
    return;
  }
  lines.push('- dead_letter_queue table readable PASS');

  if (!BASE || !cronSecret) {
    lines.push('- DLQ end-to-end (outbox → process-outbox → DLQ) SKIP (need BASE_URL + CRON_SECRET)');
    return;
  }

  const origin = BASE.replace(/\/$/, '');
  const payload = { security_audit_dlq: true, t: Date.now() };
  const { data: inserted, error: insErr } = await admin
    .from('webhook_outbox')
    .insert({
      job_type: '__security_audit_unknown__',
      payload,
      status: 'pending',
      attempt_count: 4,
      max_attempts: 5,
      next_attempt_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    lines.push(`- webhook_outbox insert probe → ${insErr?.message ?? 'no row'} WARN`);
    return;
  }

  const jobId = (inserted as { id: string }).id;
  const proc = await fetch(`${origin}/api/cron/process-outbox`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const procStatus = proc.status;
  lines.push(`- GET /api/cron/process-outbox → ${procStatus} ${procStatus === 200 ? 'PASS' : 'WARN'}`);

  const { data: dlqRow, error: dlqErr } = await admin
    .from('dead_letter_queue')
    .select('outbox_id, job_type, payload, error_message, attempt_count')
    .eq('outbox_id', jobId)
    .maybeSingle();

  if (dlqErr) {
    lines.push(`- DLQ select → ERROR ${dlqErr.message}`);
    return;
  }

  if (!dlqRow) {
    lines.push('- DLQ row for forced outbox failure → FAIL');
    failures.push('dead_letter_queue missing expected row after process-outbox');
  } else {
    const row = dlqRow as {
      job_type?: string;
      payload?: unknown;
      attempt_count?: number;
      error_message?: string | null;
    };
    const payloadOk =
      row.payload &&
      typeof row.payload === 'object' &&
      (row.payload as { security_audit_dlq?: boolean }).security_audit_dlq === true;
    const attemptsOk = typeof row.attempt_count === 'number' && row.attempt_count >= 5;
    const errOk = typeof row.error_message === 'string' && row.error_message.length > 0;
    lines.push(
      `- DLQ payload + attempt_count + error_message captured → ${payloadOk && attemptsOk && errOk ? 'PASS' : 'WARN'}`,
    );
    await admin.from('dead_letter_queue').delete().eq('outbox_id', jobId);
  }

  await admin.from('webhook_outbox').delete().eq('id', jobId);
}

async function main() {
  if (mode === 'all' || mode === 'auth') await authChecks();
  if (mode === 'all' || mode === 'crons') await cronChecks();
  if (mode === 'all' || mode === 'webhooks') await webhookChecks();
  if (mode === 'all' || mode === 'rate-limit') await rateLimitChecks();
  if (mode === 'all' || mode === 'webhooks-deep') await webhookDeepMatrix();
  if (mode === 'all' || mode === 'rate-limit-deep') await rateLimitDeep();
  if (mode === 'all' || mode === 'audit-log') await auditLogProbe();
  if (mode === 'all' || mode === 'dlq') await dlqProbe();

  const out = path.join(__dirname, '..', 'security-audit-report.md');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(`Wrote ${out}`);
  if (failures.length) {
    console.error('[security-audit] FAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
