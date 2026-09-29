import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    environment: 'happy-dom',
  },
})
