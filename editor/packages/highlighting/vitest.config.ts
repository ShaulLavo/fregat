import { resolve } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { fs: { allow: [resolve(import.meta.dirname, '../../..')] } },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
        },
      },
      {
        // The real Shiki worker and grammars.
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        // Workers, WebAssembly and transfers in the other engines; run with `test:engines`.
        test: {
          name: 'engines',
          include: ['test/service.browser.test.ts', 'test/structure.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'firefox', name: 'engines-firefox' },
              { browser: 'webkit', name: 'engines-webkit' },
            ],
          },
        },
      },
    ],
  },
})
