# End-to-end testing (Playwright)

> Synced against the live code on 2026-07-18. Live product domain is **tutoringhq.app**
> (centerhq.app is retired) (verified 2026-07-18).

Centre-owner and optional super-admin sessions are saved under `tests/e2e/.auth/` (gitignored). Specs are split across Playwright projects so anonymous flows never reuse a logged-in cookie jar.

## Required environment variables

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_BASE_URL` | Target deployment (e.g. `https://tutoringhq.app` or `http://localhost:3000`) |
| `TEST_PHONE` | Centre owner login (**exact** phone string; no automatic leading-zero stripping) |
| `TEST_PIN` | Centre owner PIN |

Optional:

| Variable | Purpose |
|----------|---------|
| `TEST_CENTER_ID` | Force seed fixtures to a specific centre UUID (overrides resolving centre from `TEST_PHONE`) |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Enables DB seed (`tests/e2e/setup/seed.ts`) before the centre-owner setup |
| `TEST_SUPER_ADMIN_PHONE` + `TEST_SUPER_ADMIN_PIN` | Super-admin login fixture (`tests/e2e/.auth/super-admin.json`). If `TEST_SUPER_ADMIN_PHONE` is unset, an empty storage file is written and **admin-only specs self-skip** with `TEST_SUPER_ADMIN_PHONE not configured`. |
| `PLAYWRIGHT_LOGIN_LOCALE` | Login path locale (`en` or `ar`; default `en`) |
| `CLEANUP_TEST_DATA=1` | When set, the next seed run **deletes** prior `e2e_seed:v1` rows for the resolved centre (see `seed.ts`) |

### Local `.env` file

Create **`tests/e2e/.env.local`** (gitignored via `.env*` rules) or use repo-root `.env.test` / `.env.local`. Playwright loads, in order:

1. `.env.test`
2. `.env.local` (repo root)
3. `tests/e2e/.env.local`

Example:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000
TEST_PHONE=+201333333333
TEST_PIN=333333
TEST_SUPER_ADMIN_PHONE=+201111111111
TEST_SUPER_ADMIN_PIN=111111
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## How to run

Install browsers once:

```bash
npx playwright install chromium
```

Centre-owner smoke (matches CI quick path):

```bash
npx playwright test --project=desktop-chrome
```

Full matrix (all projects):

```bash
npx playwright test
```

Projects:

- **`setup`** — centre-owner login → `tests/e2e/.auth/centre-owner.json`
- **`setup-super-admin`** — depends on `setup`; super-admin login or empty storage
- **`desktop-chrome`** — authenticated specs (excludes unauth-only, mobile-only, super-admin-only files)
- **`mobile-chrome`** — `mobile-cart` + `responsive-375` at **375×812**
- **`unauth-chrome`** — empty `storageState`; pricing, signup mocks, locale login
- **`desktop-super-admin`** — `admin-pages`, `card-order-full`

## Seeding

If Supabase env vars are set, `global.setup.ts` calls `seedE2EDatabase()` once before login. It ensures:

- Six roster students: `Test Student 01..05` (`TEST-00001`…`TEST-00005`) plus `Test Student No Card` (`TEST-NOCARD01`)
- One **paid** `card_order` with **blank** line items only (so roster students stay eligible for recommendations)

Idempotent: existing rows are detected by fixed order IDs / `student_number` / `notes = e2e_seed:v1`.

## Specs that require super-admin storage

Runs under **`desktop-super-admin`** only:

- `admin-pages.spec.ts`
- `card-order-full.spec.ts`

Without `TEST_SUPER_ADMIN_PHONE`, tests in those files **skip** with a clear reason.

## Known fragile areas

- **Paymob / signup iframes** — signup specs mock APIs; real iframe flows may still drift.
- **Bosta / carrier polling** — order timelines and tracking UIs can time out under slow networks.
- **Rate limits** — login specs deliberately avoid repeated failed PIN attempts.

Treat persistent failures as **small follow-up fixes** per spec; do not block landing auth-fixture infrastructure on unrelated flakes.

## CI

- **`test.yml`** runs `npm run test:e2e` after unit tests (uploads HTML report on failure). The run is configured as **non-blocking** while the suite stabilizes (`continue-on-error` on the Playwright step).
- **`ci.yml`** includes an optional Playwright job with the same philosophy.

Configure GitHub secrets: `PLAYWRIGHT_BASE_URL`, `TEST_PHONE`, `TEST_PIN`, optionally `TEST_SUPER_ADMIN_PHONE`, `TEST_SUPER_ADMIN_PIN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
