/**
 * Security probe harness (Prompt 7 PART C). Run: npx tsx scripts/security-audit.ts [--webhooks|--crons|--auth|--all]
 * Requires BASE_URL or PLAYWRIGHT_BASE_URL for HTTP checks; skips gracefully when unset (CI smoke prints SKIP).
 */
import fs from 'fs';
import path from 'path';

type Mode = 'webhooks' | 'crons' | 'auth' | 'rate-limit' | 'all';

const args = process.argv.slice(2);
const mode: Mode = args.includes('--all')
  ? 'all'
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

const lines: string[] = [`# Security audit`, `Mode: ${mode}`, `Base: ${BASE || '(none — HTTP checks skipped)'}`, '',];
const failures: string[] = [];

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
      else if (ent.name === 'route.ts') routes.push('/api/cron/' + path.relative(cronRoot, path.dirname(p)).replace(/\\/g, '/'));
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
  lines.push('- Full HMAC replay matrix requires staging secrets — run manually before prod.');
  lines.push('- PAYMOB/Bosta/WhatsApp: valid signed POST → 200; replay idempotent; bad sig → 401 (documented in SECURITY_MAINTENANCE.md).');
}

async function rateLimitChecks() {
  lines.push('## Rate limit');
  lines.push('- UPSTASH ratelimit: verify /api/login burst returns 429 in staging (manual).');
}

async function main() {
  if (mode === 'all' || mode === 'auth') await authChecks();
  if (mode === 'all' || mode === 'crons') await cronChecks();
  if (mode === 'all' || mode === 'webhooks') await webhookChecks();
  if (mode === 'all' || mode === 'rate-limit') await rateLimitChecks();

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
