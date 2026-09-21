import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Runtime-neutral package: plain `vitest`, no Bun runtime needed. happy-dom
// rather than jsdom, per the repo's environment preference.
//
// The compiler runs here because it runs in the app that ships these primitives: without it a test
// exercises unmemoized source, and manual memoization the compiler makes redundant looks load-bearing.
export default defineConfig({
  plugins: [react({ compiler: true })],
  resolve: {
    alias: { '@workspace/ui': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    name: 'dom',
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/env/dom.ts'],
  },
})
