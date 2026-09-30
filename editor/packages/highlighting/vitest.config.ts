import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import { workspaceRoot } from '../../scripts/workspace-root'

// Fails a third-party grammar chunk the way an outage would, so tests reach real acquisition errors.
const blockRequests: BrowserCommand<[pattern: string]> = async ({ page }, pattern) => {
  await page.route(`**/*${pattern}*`, (route) => route.abort('failed'))
}
const unblockRequests: BrowserCommand<[pattern: string]> = async ({ page }, pattern) => {
  await page.unroute(`**/*${pattern}*`)
}
// Holds a grammar chunk until the test releases it, so work can be caught mid-acquisition.
const held = new Map<string, () => void>()
const holdRequests: BrowserCommand<[pattern: string]> = async ({ page }, pattern) => {
  const gate = new Promise<void>((resolve) => held.set(pattern, resolve))
  await page.route(`**/*${pattern}*`, async (route) => {
    await gate
    // Releasing also unroutes, which may settle the route first.
    await route.continue().catch(() => undefined)
  })
}
const releaseRequests: BrowserCommand<[pattern: string]> = async ({ page }, pattern) => {
  held.get(pattern)?.()
  held.delete(pattern)
  await page.unroute(`**/*${pattern}*`)
}
const commands = { blockRequests, unblockRequests, holdRequests, releaseRequests }

export default defineConfig({
  server: { fs: { allow: [workspaceRoot] } },
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
            commands,
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
