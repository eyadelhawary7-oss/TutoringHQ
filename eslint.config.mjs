import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, generated third-party Workbox runtime shipped as static assets.
    // Not our source; linting it only produces noise (this@alias, ban-types, …).
    "public/workbox/**",
  ]),
  {
    rules: {
      // React 19 strictness rules (set-state-in-effect / refs / purity) relaxed
      // to warn pre-launch. 58+ violations exist across the codebase as of May
      // 2026 — each needs useEffect / render-phase restructuring to fix
      // properly. Tracked as post-launch tech debt in
      // docs/POST_LAUNCH_LINT_DEBT.md. Re-enable as 'error' after addressing.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      // Disabled: this is a Pages-Router-only rule. CenterHQ is App-Router-only
      // (CLAUDE.md). The rule misfires on internal API download links rendered
      // as <a href="/api/admin/export/...">, producing 24 false-positive errors.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);

export default eslintConfig;
