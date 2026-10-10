import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'

const evidence = mkdtempSync(join(tmpdir(), 'singapore-document-paint-'))
const results: unknown[] = []
console.info('Document paint evidence', evidence)

export default defineConfig({
  plugins: [browserTestResponses()],
  server: { fs: { allow: [workspaceRoot] } },
  optimizeDeps: { exclude: ['web-tree-sitter', 'tree-sitter-md'] },
  test: {
    include: ['test/documentPaint.browser.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 1400, height: 900 },
      provider: playwright(),
      commands: {
        proofDocumentPaintScreenshot: async ({ iframe, project, page }, label: string) => {
          const target = iframe.locator('#document-paint-proof')
          const bounds = await target.boundingBox()
          if (bounds) {
            const height = Math.min(16000, Math.ceil(bounds.y + bounds.height + 100))
            await page.setViewportSize({ width: 1400, height })
            await page.locator('iframe').evaluateAll((frames, height) => {
              for (const frame of frames)
                frame.style.setProperty('height', `${height}px`, 'important')
            }, height)
          }
          const image = await target.screenshot({ animations: 'allow' })
          writeFileSync(join(evidence, `${project.name}-${label}.png`), image)
          return image.toString('base64')
        },
        proofDocumentPaintResult: async (
          { project, page },
          result: Record<string, unknown>,
          payload: string,
        ) => {
          results.push({
            ...result,
            engine: project.name,
            userAgent: await page.evaluate(() => navigator.userAgent),
            bytes: Buffer.byteLength(payload),
            gzipBytes: gzipSync(payload).byteLength,
          })
          writeFileSync(join(evidence, 'results.json'), JSON.stringify(results, null, 2))
        },
      },
      instances: ['chromium', 'webkit'].flatMap((browser) =>
        [1, 2, 3].map((deviceScaleFactor) => ({
          browser: browser as 'chromium' | 'webkit',
          name: `snapshot-${browser}-dpr${deviceScaleFactor}`,
          provider: playwright({ contextOptions: { deviceScaleFactor } }),
        })),
      ),
    },
  },
})
