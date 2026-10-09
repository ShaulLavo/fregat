import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  optimizeDeps: { include: ['@singapore-editor/core > diff'] },
  test: {
    projects: [
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 1440, height: 1100 },
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            commands: {
              noteActionKey: async ({ page }, key: string) => {
                await page.keyboard.press(key)
              },
            },
          },
        },
      },
    ],
  },
})
