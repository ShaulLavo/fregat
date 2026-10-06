import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'

export default defineConfig({
  plugins: [browserTestResponses()],
  server: { fs: { allow: [workspaceRoot] } },
  optimizeDeps: { include: ['typescript-api'] },
  test: {
    include: ['test/**/*.browser.test.ts'],
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 800, height: 600 },
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
