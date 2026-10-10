import { mkdtempSync, writeFileSync } from 'node:fs'
import { arch, cpus, release, tmpdir, type } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { proveDocumentPaintFirstFrame } from './test/env/document-paint-first-frame.ts'

const evidence = mkdtempSync(join(tmpdir(), 'singapore-document-paint-'))
const results: unknown[] = []
const require = createRequire(import.meta.url)
writeFileSync(
  join(evidence, 'environment.json'),
  JSON.stringify(
    {
      os: { type: type(), release: release(), arch: arch(), cpu: cpus()[0]?.model },
      runtime: process.versions,
      playwright: require('@playwright/test/package.json').version,
      vitest: require('vitest/package.json').version,
      method: {
        repetitions: 30,
        percentileIndex: 28,
        widths: [320, 390, 1280],
        dpr: [1, 2, 3],
        timers: 'decode, synchronous mount, forced layout; font already ready',
        pixels: 'exact RGBA, caret-only mask; live, replay and serialized HTML',
        qualification:
          'restore timing experiment; site startup and first-painted frame remain unqualified',
      },
    },
    null,
    2,
  ),
)
console.info('Document paint evidence', evidence)

export default defineConfig({
  resolve: {
    alias: {
      '@singapore-editor/core/editor': join(import.meta.dirname, 'src/editor.ts'),
      '@singapore-editor/core/document': join(import.meta.dirname, 'src/public/document.ts'),
      '@singapore-editor/core/syntax': join(import.meta.dirname, 'src/public/syntax.ts'),
      '@singapore-editor/core/extensions': join(import.meta.dirname, 'src/public/extensions.ts'),
      '@singapore-editor/core/internal/document-worker': join(
        import.meta.dirname,
        'src/document/workerReader.ts',
      ),
    },
  },
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
        proofDocumentPaintFirstFrame: async (
          { page, project },
          payload: string,
          markup: string,
          width: number,
          javaScriptEnabled: boolean,
          activationMode:
            | 'success'
            | 'refused'
            | 'throws'
            | 'missing'
            | 'missing-deferred' = 'success',
        ) =>
          proveDocumentPaintFirstFrame(
            page,
            project.name,
            evidence,
            payload,
            markup,
            width,
            javaScriptEnabled,
            activationMode,
          ),
        proofDocumentPaintCold: async (
          { page, project },
          payload: string,
          entry: string,
          fonts: readonly (readonly [string, string])[],
          width: number,
        ) => {
          const dpr = await page.evaluate(() => devicePixelRatio)
          const context = await page
            .context()
            .browser()!
            .newContext({
              deviceScaleFactor: dpr,
              viewport: { width: 1400, height: 900 },
            })
          const requests: string[] = []
          const origin = new URL(entry).origin
          const url = `${origin}/document-paint-cold-proof`
          await context.route(url, (route) =>
            route.fulfill({
              contentType: 'text/html',
              body: '<!doctype html><body style="margin:0"><div id="document-paint-proof"></div>',
            }),
          )
          context.on('request', (request) => requests.push(new URL(request.url()).pathname))
          try {
            const cold = await context.newPage()
            await cold.goto(url)
            const result = await cold.evaluate(
              async ({ payload, entry, fonts, width }) => {
                const start = performance.now()
                for (const [family, source] of fonts) {
                  const face = new FontFace(family, `url(${source})`)
                  document.fonts.add(await face.load())
                }
                await document.fonts.ready
                const fontReady = performance.now()
                const { decodePaintSnapshot, mountPaintSnapshot } = await import(
                  /* @vite-ignore */ entry
                )
                const imported = performance.now()
                const paint = decodePaintSnapshot(payload)
                const decoded = performance.now()
                const host = document.querySelector<HTMLElement>('#document-paint-proof')!
                host.style.width = `${width}px`
                const mounted = mountPaintSnapshot(host, paint, { width })
                const inserted = performance.now()
                mounted.element.getBoundingClientRect()
                const laidOut = performance.now()
                await new Promise(requestAnimationFrame)
                await new Promise(requestAnimationFrame)
                return {
                  fontWaitMs: fontReady - start,
                  importMs: imported - fontReady,
                  decodeMs: decoded - imported,
                  mountMs: inserted - decoded,
                  layoutMs: laidOut - inserted,
                  frameOpportunityMs: performance.now() - laidOut,
                  rowCount: mounted.rowCount,
                  height: mounted.height,
                }
              },
              { payload, entry, fonts, width },
            )
            const image = await cold.locator('#document-paint-proof').screenshot()
            writeFileSync(join(evidence, `${project.name}-cold-entry.png`), image)
            return { ...result, requests, image: image.toString('base64') }
          } finally {
            await context.close()
          }
        },
        proofDocumentPaintThrottle: async ({ page, project }, rate: number) => {
          if (!project.name.includes('chromium')) return false
          const session = await page.context().newCDPSession(page)
          await session.send('Emulation.setCPUThrottlingRate', { rate })
          return true
        },
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
