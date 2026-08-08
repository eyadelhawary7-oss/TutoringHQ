// Mint a browser storage state from a Supabase password-grant session.
//
// Parameterised sibling of mint-session.mjs, which hardcodes one session file
// and one verification route. The re-diff needs three roles — centre owner,
// teacher, super-admin — and each must be verified against a route its OWN role
// can reach, or a redirect to /login reads as a bad credential when it is
// really a wrong-role check.
//
// Usage: node scripts/rediff/mint-session-role.mjs <sessionJson> <outState> <verifyRoute>
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const REF = 'lczmjpnbuhnsislcvzar';
const [, , sessionPath, outPath, verifyRoute] = process.argv;
if (!sessionPath || !outPath || !verifyRoute) {
  console.error('usage: mint-session-role.mjs <sessionJson> <outState> <verifyRoute>');
  process.exit(2);
}

const s = JSON.parse(readFileSync(sessionPath, 'utf8'));
if (!s.access_token) {
  console.error('no access_token in', sessionPath);
  process.exit(2);
}
const session = {
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_in: s.expires_in,
  expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
  token_type: s.token_type || 'bearer',
  user: s.user,
};

const val = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
const CH = 3180;
const parts = [];
for (let i = 0; i < val.length; i += CH) parts.push(val.slice(i, i + CH));
const name = `sb-${REF}-auth-token`;
const cookies = (parts.length === 1 ? [{ name, value: val }] : parts.map((v, i) => ({ name: `${name}.${i}`, value: v })))
  .map((c) => ({
    ...c,
    domain: 'localhost',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
    expires: session.expires_at,
  }));

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies(cookies);
const p = await ctx.newPage();
await p.goto(`http://localhost:3000${verifyRoute}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForTimeout(8000);
const url = p.url();
const ok = !url.includes('/login');
console.log(`cookies: ${cookies.length} | verify ${verifyRoute} -> ${url.replace('http://localhost:3000', '')} | AUTH: ${ok ? 'OK' : 'REDIRECTED TO LOGIN'}`);
const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
console.log('text:', txt.slice(0, 200));
if (ok) {
  await ctx.storageState({ path: outPath });
  console.log('state saved ->', outPath);
}
await b.close();
process.exit(ok ? 0 : 1);
