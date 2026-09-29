import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'dom',
          css: true,
          environment: 'happy-dom',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
          include: ['test/**/*.browser.test.ts'],
        },
      },
    ],
  },
})
