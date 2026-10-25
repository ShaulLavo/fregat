import { defineConfig } from 'vitest/config'

// Runtime-neutral package (valibot + fast-check); runs under plain Node.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
