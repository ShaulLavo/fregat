import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Runtime-neutral package: plain `vitest`, no Bun runtime needed. happy-dom
// rather than jsdom, per the repo's environment preference.
export default defineConfig({
  resolve: {
    alias: { '@workspace/ui': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/env/dom.ts'],
  },
})
