import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { browserTestResponses } from './test/env/browser-test-responses.ts'

const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
}

export default defineConfig({
  plugins: [browserTestResponses(), react({ compiler: true }), tailwindcss()],
  resolve: { alias, dedupe: ['react', 'react-dom', '@base-ui/react'] },
  optimizeDeps: { include: ['@workspace/ui > @base-ui/react/context-menu'] },
  test: {
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      screenshotFailures: false,
      instances: [{ browser: 'chromium', viewport: { height: 600, width: 560 } }],
    },
    include: ['src/features/workspace/tests/tree-view*.browser.tsx'],
  },
})
