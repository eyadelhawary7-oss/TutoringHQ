// Batch-capture many live routes at 390px with ONE browser: screenshot + RENDERED text.
//
// Why batched: one Chromium per route does not survive a 10-agent fan-out on a
// 4-core box, and a capture that times out under load gets written up as a
// missing screen. One browser per agent, routes sequential inside it.
//
// Entry 31: mutate the LIVE DOM, never a detached clone — innerText is only
// CSS-aware for attached nodes, or hidden panels read as visible and a Week
// grid nobody can see gets recorded as adopted.
//
// A failure here is reported as a TOOLING failure with its reason, never as an
// absent feature. `ok:false` in the manifest means "not measured", which is a
// different claim from "not built" and must never be collapsed into it.
//
// Usage: node scripts/rediff/capture-batch.mjs <outDir> <route[,route...]> [waitMs] [stateFile]
//
// stateFile selects the ROLE. The re-diff runs three of them and they are not
// interchangeable — an admin screen captured with the owner's session redirects
// to /login, which reads as an absent feature unless the manifest catches it:
//   /tmp/state333.json    centre owner of Test Center 333   (default)
//   /tmp/state-teacher.json  teacher, Aly Shady
//   /tmp/state-admin.json    super-admin
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
const routes = (process.argv[3] || '').split(',').map((r) => r.trim()).filter(Boolean);
const wait = Number(process.argv[4] || 5000);
const stateFile = process.argv[5] || process.env.REDIFF_STATE || '/tmp/state333.json';
if (!outDir || routes.length === 0) {
  console.error('usage: capture-batch.mjs <outDir> <route[,route...]> [waitMs] [stateFile]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const slug = (r) => r.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_') || 'root';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: stateFile,
  deviceScaleFactor: 2,
});

console.log(`role state: ${stateFile}`);

const manifest = [];
for (const route of routes) {
  const name = slug(route);
  const rec = { route, name, ok: false };
  const page = await ctx.newPage();
  const pageErrors = [];
  const httpErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('response', (r) => {
    if (r.status() >= 400) {
      httpErrors.push(`${r.status()} ${r.url().replace('http://localhost:3000', '')}`.slice(0, 140));
    }
  });
  try {
    await page.goto(`http://localhost:3000${route}`, {
      waitUntil: 'domcontentloaded',
      // Dev-mode FIRST compiles on this box have taken 109s and 194s. A 60s
      // timeout turns an uncompiled route into a `tooling` failure that reads
      // like a broken screen, so the ceiling is well above the worst observed
      // compile rather than just above the typical one.
      timeout: 240000,
    });
    // Dev compiles client bundles lazily, so a fixed sleep photographs skeleton
    // cards and a "Compiling…" pill. Wait for the network to settle first; if it
    // never does, fall through to the sleep rather than fail the route.
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(wait);
    // Skeletons are the tell that data has not arrived. Give them one more
    // settle before photographing, and record whether they survived it — a
    // screen still skeletal was NOT measured.
    const skeletonSel = '[class*="animate-pulse"],[data-skeleton],[aria-busy="true"]';
    if (await page.locator(skeletonSel).first().isVisible().catch(() => false)) {
      await page.waitForTimeout(6000);
    }
    rec.stillSkeleton = await page
      .locator(skeletonSel)
      .first()
      .isVisible()
      .catch(() => false);
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
    // Strip ONLY script/style. The earlier harness also stripped
    // `nav,aside,header` as "chrome" and cut real content with it: this app
    // renders the centre name, the plan chip and the verification badge INSIDE
    // <header>, so /en/dashboard captured 15 characters and read as an empty
    // screen. Repetitive chrome in the text is harmless; missing content is not.
    const text = await page.evaluate(() => {
      for (const el of document.querySelectorAll('script,style')) el.remove();
      return document.body.innerText;
    });
    writeFileSync(join(outDir, `${name}.txt`), text);
    rec.ok = true;
    rec.finalUrl = page.url().replace('http://localhost:3000', '');
    // A route that bounced to /login was NOT measured. Say so explicitly rather
    // than let an agent diff the login page against a dashboard drawing.
    rec.redirectedToLogin = rec.finalUrl.includes('/login');
    rec.chars = text.length;
    rec.pageErrors = pageErrors.slice(0, 3);
    rec.httpErrors = [...new Set(httpErrors)].slice(0, 6);
  } catch (err) {
    rec.ok = false;
    rec.failure = String(err).slice(0, 300);
  }
  await page.close();
  manifest.push(rec);
  const status = rec.ok
    ? `OK chars=${rec.chars}${rec.redirectedToLogin ? ' [REDIRECTED-TO-LOGIN: NOT MEASURED]' : ''}` +
      `${rec.stillSkeleton ? ' [STILL-SKELETON: NOT MEASURED]' : ''}` +
      `${rec.httpErrors.length ? ` http=${rec.httpErrors.length}` : ''}` +
      `${rec.pageErrors.length ? ` pageErr=${rec.pageErrors.length}` : ''}`
    : `FAILED ${rec.failure}`;
  console.log(`${route} -> ${name}  ${status}`);
}

writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
const okCount = manifest.filter((m) => m.ok && !m.redirectedToLogin).length;
console.log(`\nmeasured ${okCount}/${routes.length} routes -> ${outDir}`);
