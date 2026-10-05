import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, extname } from 'node:path'
import { installInputWorkerProof } from '../input-worker-proof.mjs'

let browser
let directory
const fixtures = {
  ordinary: 'export const value = 1;\n'.repeat(32),
  'short-lines': '//same source identity\n'.repeat(32),
}
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'input-buffer-identity-'))
  await build({
    root: resolve(import.meta.dirname, '..'),
    configFile: false,
    logLevel: 'silent',
    worker: { format: 'es' },
    build: { outDir: directory, emptyOutDir: true },
  })
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

test.each(['ordinary', 'short-lines'])(
  'replacement into %s gets its own observed source identity',
  async (next) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } })
    await context.route('http://localhost:4173/**', async (route) => {
      const url = new URL(route.request().url())
      const fixture = /^\/frozen-fixtures\/([^/]+)\.txt$/.exec(url.pathname)?.[1]
      if (fixture) return route.fulfill({ body: fixtures[fixture], contentType: 'text/plain' })
      const path = resolve(directory, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
      const types = {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.wasm': 'application/wasm',
      }
      await route.fulfill({
        body: await readFile(path),
        contentType: types[extname(path)] ?? 'application/octet-stream',
      })
    })
    const page = await context.newPage()
    await page.addInitScript(installInputWorkerProof, null)
    try {
      await page.goto('http://localhost:4173/')
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() =>
        __stress.warmInputSubject('ordinary', 1, false, true, false, 'platform'),
      )
      const known = await page.evaluate(() => __stress.settleConsumers())
      expect(known.sessions).toHaveLength(2)
      expect(known.minimaps).toHaveLength(1)
      expect(known.sessions.every((s) => s.current && s.answered)).toBe(true)
      expect(known.minimaps.every((m) => m.current && m.renderedAfterSource)).toBe(true)
      await page.evaluate(
        (next) => __stress.warmInputSubject(next, 1, false, true, false, 'platform'),
        next,
      )
      const replaced = await page.evaluate(() => __stress.settleConsumers())
      expect(replaced.sessions).toHaveLength(2)
      expect(replaced.minimaps).toHaveLength(1)
      expect(replaced.sessions.every((s) => s.current && s.answered)).toBe(true)
      expect(replaced.minimaps.every((m) => m.current && m.renderedAfterSource)).toBe(true)
    } finally {
      await page.evaluate(() => __stress.dispose())
      await context.close()
    }
  },
  20000,
)
