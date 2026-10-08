import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.browser.test.ts', 'test/**/*.server.test.ts'],
  },
})
