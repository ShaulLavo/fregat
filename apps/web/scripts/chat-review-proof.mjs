import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const app = resolve(import.meta.dirname, '..')
const origin = process.env.CHAT_PROOF_URL ?? 'http://127.0.0.1:3300'
const server = process.env.CHAT_PROOF_SERVER ?? 'http://127.0.0.1:3301'
const artifacts =
  process.env.CHAT_PROOF_ARTIFACTS ?? '/work/tmp/platform-chat-parity/review-fix-browser'
const bundle = resolve(artifacts, 'bundle')
await mkdir(artifacts, { recursive: true })
await build({
  configFile: false,
  root: app,
  base: '/__chat-review-proof__/',
  logLevel: 'error',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(app, 'src') }, dedupe: ['react', 'react-dom'] },
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(server) },
  worker: { format: 'es' },
  build: {
    outDir: bundle,
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: false,
    rollupOptions: {
      input: resolve(app, 'scripts/chat-review-proof-entry.mjs'),
      output: { entryFileNames: 'proof.js' },
    },
  },
})
const css = (await readdir(resolve(bundle, 'assets'))).find((name) => name.endsWith('.css'))
await writeFile(
  resolve(bundle, 'index.html'),
  `<html class="dark"><head><link rel="stylesheet" href="./assets/${css}"></head><body><div id="proof-root"></div><script type="module" src="./proof.js"></script></body></html>`,
)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, colorScheme: 'dark' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
async function updateFixture(action) {
  await page.evaluate(async (action) => {
    window.reviewFixes[action]()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }, action)
}
try {
  await page.route(`${origin}/__chat-review-proof__/**`, (route) => {
    const filename =
      new URL(route.request().url()).pathname.replace('/__chat-review-proof__/', '') || 'index.html'
    return route.fulfill({ path: resolve(bundle, filename) })
  })
  await page.route('https://copy-image.test/result.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await page.route('https://machine-notice.test/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'The test machine is offline.' }),
    }),
  )
  await page.goto(`${origin}/__chat-review-proof__/index.html`)
  await page.getByText('Chat is ready.', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Dismiss shaul-mac connection notice' }).count(),
    0,
  )
  await updateFixture('selectRemote')
  const dismiss = page.getByRole('button', { name: 'Dismiss shaul-mac connection notice' })
  await dismiss.waitFor()
  const notice = dismiss.locator('..')
  assert.equal(
    await notice.getByText('shaul-mac · Server setup needed', { exact: true }).count(),
    1,
  )
  assert.ok(!(await notice.textContent()).includes('bun run server:install'))
  const compact = await notice.boundingBox()
  await page.screenshot({ path: resolve(artifacts, 'compact-notice.png') })
  await page.getByRole('button', { name: 'shaul-mac connection details' }).click()
  await page.getByText(/The SSH machine could not be reached/).waitFor()
  await page.locator('[data-slot="popover-content"]').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    )
  })
  await page.screenshot({ path: resolve(artifacts, 'notice-details.png') })
  await page.keyboard.press('Escape')
  await dismiss.click()
  await updateFixture('repeatError')
  assert.equal(await dismiss.count(), 0)
  await updateFixture('pending')
  assert.equal(await dismiss.count(), 0)
  await updateFixture('repeatError')
  assert.equal(await dismiss.count(), 0)
  await updateFixture('changedError')
  await dismiss.waitFor()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await dismiss.waitFor()
  await updateFixture('repeatError')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('shaul-mac · Server setup needed', { exact: true }).waitFor()
  const narrow = await notice.boundingBox()
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390)
  await page.screenshot({ path: resolve(artifacts, 'narrow-notice.png') })
  await updateFixture('selectLocal')
  assert.equal(await dismiss.count(), 0)
  const search = page.locator('[data-proof-search]')
  assert.equal(await search.getByLabel('Failed', { exact: true }).count(), 0)
  await search.getByRole('button', { name: 'rg absent existing.txt', exact: true }).click()
  await search.getByText('No matches · Exit code 1', { exact: true }).waitFor()
  const copied = await page.evaluate(() => window.reviewFixes.copy())
  assert.equal(copied.text, 'Before ![Result](https://copy-image.test/result.png) after.')
  assert.ok(copied.html.includes('<img'))
  assert.ok(!copied.html.includes('<button'))
  assert.deepEqual(errors, [])
  const result = {
    compact,
    narrow,
    unrelatedHidden: true,
    dismissSurvivesRepeat: true,
    detailsOnDemand: true,
    newFailureVisible: true,
    retryAvailable: true,
    noMatchNeutral: true,
    copied,
    errors,
  }
  await writeFile(resolve(artifacts, 'proof.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failed.png') })
  await writeFile(
    resolve(artifacts, 'failed.json'),
    JSON.stringify({ errors, body: await page.locator('body').innerText() }, null, 2),
  )
  console.error({ errors })
  throw error
} finally {
  await browser.close()
}
