import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'scripts/**/*.test.{ts,mjs}',
      'apps/web/scripts/bundle-gate.test.ts',
      'apps/web/scripts/bundle-owners.test.ts',
      'apps/web/scripts/dev-source-alias.test.ts',
      'apps/web/scripts/first-load-files.test.ts',
      'apps/web/scripts/phosphor-weight-plugin.test.ts',
      'apps/web/scripts/shard-durations.test.ts',
      'apps/web/scripts/shell-chunks-plugin.test.ts',
      'apps/web/vite.config.test.ts',
    ],
  },
})
