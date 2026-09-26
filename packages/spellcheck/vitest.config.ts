import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'

const proofRowScreenshot: BrowserCommand<[hostId: string]> = async ({ iframe }, hostId) => {
  const row = iframe.locator(`#${hostId} [data-editor-virtual-row="0"]`)
  const image = await row.screenshot({ animations: 'disabled' })
  return image.toString('base64')
}

const proofType: BrowserCommand<[text: string]> = async ({ page }, text) => {
  await page.keyboard.type(text)
}

const browser = (instances: { browser: 'chromium' | 'firefox' | 'webkit'; name?: string }[]) => ({
  enabled: true,
  headless: true,
  viewport: { width: 800, height: 600 },
  fileParallelism: false,
  provider: playwright(),
  commands: { proofRowScreenshot, proofType },
  instances,
})

export default defineConfig({
  // The worker imports it; discovering it mid-run makes Vite reload the page under a running test.
  optimizeDeps: { include: ['cspell-trie-lib'] },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts', 'test/plugin.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/plugin.test.ts'],
        },
      },
      {
        // The real worker, real syntax and real keyboard input.
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
          exclude: ['test/paint.browser.test.ts', 'test/service.browser.test.ts'],
          browser: browser([{ browser: 'chromium' }]),
        },
      },
      {
        // Not part of `test`: run with `bun run bench:typing`.
        test: {
          name: 'typing-cost',
          include: ['bench/typing.browser.test.ts'],
          browser: browser([{ browser: 'chromium' }]),
        },
      },
      {
        // Wavy lines are where engines disagree about highlight paint; workers and DecompressionStream
        // are checked in each engine too.
        test: {
          name: 'engines',
          include: ['test/paint.browser.test.ts', 'test/service.browser.test.ts'],
          browser: browser([
            { browser: 'chromium', name: 'engines-chromium' },
            { browser: 'firefox', name: 'engines-firefox' },
            { browser: 'webkit', name: 'engines-webkit' },
          ]),
        },
      },
    ],
  },
})
