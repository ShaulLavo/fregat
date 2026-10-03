import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { fs: { allow: [workspaceRoot] } },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.node.test.ts'],
        },
      },
      {
        // Tests that import '@singapore-editor/core/*' by name resolve through the
        // exports map to dist/, which is what public-api.test.ts is for — it
        // checks the published facade rather than the source behind it. The
        // build is ordered ahead of the tests in turbo.json so that artifact is
        // current; running vitest here directly reads whatever was last built.
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts', 'test/**/*.node.test.ts'],
        },
      },
      {
        // Geometry that only a real engine can answer: caret rects, hit tests
        // and measured advances under a CSS transform. happy-dom reports every
        // rect empty, so these assertions are meaningless anywhere else.
        // Discovered mid-run, these make Vite reload and strand the browser test that was loading.
        plugins: [browserTestResponses()],
        server: { fs: { allow: [workspaceRoot] } },
        optimizeDeps: {
          // tree-sitter-md is plain ESM over web-tree-sitter; served as-is, it is never discovered.
          exclude: ['web-tree-sitter', 'tree-sitter-md'],
          include: [
            '@shikijs/engine-oniguruma',
            '@shikijs/engine-oniguruma/wasm-inlined',
            'shiki/core',
          ],
        },
        test: {
          name: 'browser',
          // Keep browser timing probes clear of Node/DOM workers and other browser files.
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            headless: true,
            // Fit the preview without scaling so pixel checks compare the actual paint.
            viewport: { width: 800, height: 600 },
            fileParallelism: false,
            provider: playwright(),
            commands: {
              proofClipboardPermissions: async ({ page }) => {
                await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
              },
              proofPointerDrag: async (
                { page },
                start: { x: number; y: number },
                end: { x: number; y: number },
              ) => {
                await page.mouse.move(start.x, start.y)
                await page.mouse.down()
                await page.mouse.move(end.x, end.y, { steps: 5 })
                await page.mouse.up()
              },
              proofKeyPress: async ({ page }, key: string) => {
                await page.keyboard.press(key)
              },
              proofKeyDown: async ({ page }, key: string) => {
                await page.keyboard.down(key)
              },
              proofKeyUp: async ({ page }, key: string) => {
                await page.keyboard.up(key)
              },
              proofType: async ({ page }, text: string) => {
                await page.keyboard.type(text)
              },
              // What an IME sends: a candidate over an optional replacement range, then a commit.
              proofImeComposition: async (
                { page },
                text: string,
                replacement: readonly [number, number] | null = null,
              ) => {
                const cdp = await page.context().newCDPSession(page)
                const range = replacement
                  ? { replacementStart: replacement[0], replacementEnd: replacement[1] }
                  : {}
                await cdp.send('Input.imeSetComposition', {
                  text,
                  selectionStart: text.length,
                  selectionEnd: text.length,
                  ...range,
                })
                await cdp.detach()
              },
              proofInsertText: async ({ page }, text: string) => {
                const cdp = await page.context().newCDPSession(page)
                await cdp.send('Input.insertText', { text })
                await cdp.detach()
              },
              proofRowScreenshot: async ({ iframe }, hostId: string) => {
                const row = iframe.locator(`#${hostId} [data-editor-virtual-row="0"]`)
                const image = await row.screenshot({ animations: 'disabled' })
                return image.toString('base64')
              },
              proofViewportScreenshot: async ({ iframe }, hostId: string) => {
                const image = await iframe
                  .locator(`#${hostId}`)
                  .screenshot({ animations: 'disabled' })
                return image.toString('base64')
              },
            },
            instances: [{ browser: 'chromium' }],
          },
          include: ['test/**/*.browser.test.ts'],
          exclude: ['test/highlightPaint.browser.test.ts'],
        },
      },
      {
        plugins: [browserTestResponses()],
        test: {
          name: 'highlight-paint',
          sequence: { groupOrder: 2 },
          include: ['test/highlightPaint.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 800, height: 600 },
            fileParallelism: false,
            provider: playwright(),
            commands: {
              proofHighlightPaintScreenshot: async ({ iframe }, hostId: string) => {
                const image = await iframe
                  .locator(`#${hostId} [data-editor-virtual-row="0"]`)
                  .screenshot({ animations: 'disabled' })
                return image.toString('base64')
              },
            },
            instances: [
              { browser: 'chromium', name: 'highlight-paint-chromium' },
              { browser: 'firefox', name: 'highlight-paint-firefox' },
              { browser: 'webkit', name: 'highlight-paint-webkit' },
            ],
          },
        },
      },
    ],
  },
})
