import { defineConfig, devices } from '@playwright/test'

const APP_HOST = '127.0.0.1'
const APP_PORT = 4177
const APP_ORIGIN = new URL(`http://${APP_HOST}:${APP_PORT}`).origin

export default defineConfig({
  testDir: 'test',
  testMatch: '**/*.spec.ts',
  webServer: {
    command: `bun run dev -- --host ${APP_HOST} --port ${APP_PORT}`,
    reuseExistingServer: !process.env.CI,
    url: APP_ORIGIN,
  },
  use: {
    baseURL: APP_ORIGIN,
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],
})
