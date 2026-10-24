import type { CDPSession } from '@playwright/test'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'

const proofRowScreenshot: BrowserCommand<[hostId: string]> = async ({ iframe }, hostId) => {
  const row = iframe.locator(`#${hostId} [data-editor-virtual-row="0"]`)
  const image = await row.screenshot({ animations: 'disabled' })
  return image.toString('base64')
}

let profiling: CDPSession | null = null

const proofType: BrowserCommand<[text: string]> = async ({ page }, text) => {
  await page.keyboard.type(text)
}

const browser = (instances: { browser: 'chromium' | 'firefox' | 'webkit'; name?: string }[]) => ({
  enabled: true,
  headless: true,
  viewport: { width: 800, height: 600 },
  fileParallelism: false,
  provider: playwright(),
  commands: {
    proofRowScreenshot,
    proofType,
    proofProfileStart: async ({ page }) => {
      profiling = await page.context().newCDPSession(page)
      await profiling.send('Profiler.enable')
      await profiling.send('Profiler.start')
    },
    proofProfileStop: async () => {
      if (!profiling) return []
      const { profile } = await profiling.send('Profiler.stop')
      await profiling.detach()
      profiling = null
      return profile.nodes
        .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
        .slice(0, 20)
        .map((node) => ({
          function: node.callFrame.functionName,
          url: node.callFrame.url,
          samples: node.hitCount,
        }))
    },
    proofPaste: async ({ page, iframe }, text: string) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await iframe
        .locator('body')
        .evaluate(async (_, value) => navigator.clipboard.writeText(value), text)
      await page.keyboard.press('Control+v')
    },
  },
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
