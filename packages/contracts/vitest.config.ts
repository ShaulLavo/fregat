import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Runtime-neutral package (valibot + fast-check); runs under plain Node.
export default defineConfig({
  resolve: {
    alias: {
      '@fregat/hotkeys': fileURLToPath(
        new URL('../../hotkeys/packages/hotkeys/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
