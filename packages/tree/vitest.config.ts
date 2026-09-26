import path from 'node:path'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const alias = {
  '@workspace/tree': path.resolve(import.meta.dirname, './src'),
}

// The compiler runs here because it runs in the app that mounts this fork: without it a test
// exercises unmemoized source, and manual memoization the compiler makes redundant looks load-bearing.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react({ compiler: true })],
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          exclude: ['src/**/*.browser.tsx'],
        },
      },
      {
        plugins: [react({ compiler: true })],
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            screenshotFailures: false,
            instances: [{ browser: 'chromium', viewport: { height: 600, width: 560 } }],
          },
        },
      },
    ],
  },
})
