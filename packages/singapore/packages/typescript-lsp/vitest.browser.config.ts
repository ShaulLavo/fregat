import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { paritySourceIdentity } from './test/parity/source.ts'

const require = createRequire(import.meta.url)
const typeScriptRoot = dirname(require.resolve('typescript-api/package.json'))

export default defineConfig({
  plugins: [browserTestResponses()],
  server: { fs: { allow: [workspaceRoot, typeScriptRoot] } },
  optimizeDeps: { include: ['typescript-api'] },
  test: {
    include: ['test/**/*.browser.test.ts'],
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 800, height: 600 },
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox', include: ['test/parity.browser.test.ts'] },
        { browser: 'webkit', include: ['test/parity.browser.test.ts'] },
      ],
      commands: {
        typescriptParityBrowserRuntime: ({ context, page }) => {
          const browser = context.browser()
          if (!browser) throw new TypeError('Browser runtime is unavailable')
          return {
            engine: browser.browserType().name(),
            version: browser.version(),
            workers: page.workers().map((worker) => worker.url()),
            source: paritySourceIdentity(),
          }
        },
      },
    },
  },
})
