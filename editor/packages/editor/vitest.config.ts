import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { playwright } from '@vitest/browser-playwright'
import { devices } from '@playwright/test'
import { defineConfig } from 'vitest/config'

const crossEngineScrollTests = [
  'test/{virtualizedTextView,virtualizedTextViewGeometry,wheelScrollTarget,gutterScroll,gutterLeadingInset,gutterPointerEvents,wrappedLineGutter,mouseSelectionAutoScroll,navigationReveal,initialViewport,firstPaint,longLineMeasurements,millionLinePaint,codeViewport,renderDisposal,rowPresentation,proportionalRows,proportionalWrap,freeSansShaping,freeSansNativeCarets,wordWrap,defaultLargeDocument,metricProbeScrollExtent,tailGeometry,typography}.browser.test.ts',
]

let contentEvidence: string | undefined

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
          exclude: [
            'web-tree-sitter',
            'tree-sitter-md',
            'micromark-util-decode-string',
            'micromark-util-normalize-identifier',
          ],
          include: [
            'evlog/client',
            '@fregat/hotkeys',
            'diff',
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
                  ? {
                      replacementStart: replacement[0],
                      replacementEnd: replacement[1],
                    }
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
            instances: [
              { browser: 'chromium' },
              { browser: 'firefox', name: 'scroll-firefox', include: crossEngineScrollTests },
              { browser: 'webkit', name: 'scroll-webkit', include: crossEngineScrollTests },
            ],
          },
          include: ['test/**/*.browser.test.ts'],
          exclude: [
            // Full-document pixels and restore timings use vitest.snapshot.config.ts.
            'test/documentPaint.browser.test.ts',
            'test/highlightPaint.browser.test.ts',
            'test/markdownFencePaint.browser.test.ts',
            'test/paintOrigin.browser.test.ts',
          ],
        },
      },
      {
        plugins: [browserTestResponses()],
        server: { fs: { allow: [workspaceRoot] } },
        test: {
          name: 'content-layout',
          include: ['test/contentHeight.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 800, height: 600 },
            provider: playwright(),
            commands: {
              proofContentLayoutScreenshot: async ({ iframe, project }, width: number) => {
                contentEvidence ??= mkdtempSync(join(tmpdir(), 'singapore-content-layout-'))
                const path = join(contentEvidence, `${project.name}-${width}.png`)
                await iframe
                  .locator('#content-height-proof')
                  .screenshot({ path, animations: 'disabled' })
                return path
              },
            },
            instances: [
              { browser: 'chromium', name: 'content-layout-chromium' },
              { browser: 'firefox', name: 'content-layout-firefox' },
              { browser: 'webkit', name: 'content-layout-webkit' },
              {
                browser: 'webkit',
                name: 'content-layout-iphone',
                viewport: devices['iPhone 15'].viewport,
                provider: playwright({ contextOptions: devices['iPhone 15'] }),
              },
            ],
          },
        },
      },
      {
        plugins: [browserTestResponses()],
        server: { fs: { allow: [workspaceRoot] } },
        optimizeDeps: {
          exclude: [
            'web-tree-sitter',
            'tree-sitter-md',
            'micromark-util-decode-string',
            'micromark-util-normalize-identifier',
          ],
        },
        test: {
          name: 'wrap-layout',
          include: ['test/wrapExtent.browser.test.ts', 'test/wordWrapMarkdown.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 390, height: 844 },
            fileParallelism: false,
            provider: playwright({ contextOptions: devices['iPhone 13'] }),
            instances: [
              { browser: 'chromium', name: 'wrap-layout-chromium' },
              { browser: 'webkit', name: 'wrap-layout-iphone-webkit' },
            ],
          },
        },
      },
      {
        plugins: [browserTestResponses()],
        test: {
          name: 'paint-origin',
          sequence: { groupOrder: 2 },
          include: ['test/paintOrigin.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 800, height: 600 },
            fileParallelism: false,
            provider: playwright(),
            instances: [
              { browser: 'chromium', name: 'paint-origin-chromium' },
              { browser: 'firefox', name: 'paint-origin-firefox' },
              { browser: 'webkit', name: 'paint-origin-webkit' },
            ],
          },
        },
      },
      {
        plugins: [browserTestResponses()],
        optimizeDeps: { exclude: ['web-tree-sitter', 'tree-sitter-md'] },
        test: {
          name: 'highlight-paint',
          sequence: { groupOrder: 2 },
          include: [
            'test/highlightPaint.browser.test.ts',
            'test/markdownFencePaint.browser.test.ts',
          ],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 800, height: 600 },
            fileParallelism: false,
            provider: playwright(),
            commands: {
              proofMarkdownFenceScreenshot: async (
                { iframe },
                hostId: string,
                row: number,
                text?: string,
              ) => {
                const target = text
                  ? iframe
                      .locator(`#${hostId} .editor-virtualized-row`)
                      .filter({ hasText: text })
                      .first()
                  : iframe.locator(`#${hostId} [data-editor-virtual-row="${row}"]`)
                const image = await target.screenshot({
                  animations: 'disabled',
                })
                return image.toString('base64')
              },
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
