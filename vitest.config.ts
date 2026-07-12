import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` is a Next.js runtime guard that throws when imported outside a
      // React Server Component. Server-side libs (e.g. supabase-admin, centerNotify)
      // import it; under vitest we alias it to an empty module so those modules — and
      // the route handlers that import them — can be exercised by unit tests.
      'server-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    env: {
      TZ: 'UTC',
    },
  },
})
