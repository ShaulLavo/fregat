import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import config from './vitest.config'

export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: [
      'test/wasm-memory.browser.test.ts',
      'test/markdown.browser.test.ts',
      'test/dist.browser.test.ts',
    ],
    browser: {
      ...config.test?.browser,
      enabled: true,
      headless: true,
      instances: [
        { browser: 'chromium', provider: playwright() },
        { browser: 'firefox', provider: playwright() },
        { browser: 'webkit', provider: playwright() },
      ],
    },
  },
})
