import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'

export default defineConfig({
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
        plugins: [browserTestResponses()],
        server: { fs: { allow: [workspaceRoot] } },
        test: {
          name: 'browser',
          fileParallelism: false,
          include: ['test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 900, height: 650 },
            provider: playwright(),
            commands: {
              presenceMotion: async ({ page }, reduced: boolean) => {
                await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
              },
            },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
