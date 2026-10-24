import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.browser.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
})
