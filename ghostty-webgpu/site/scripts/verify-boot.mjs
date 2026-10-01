import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const [url, directory] = process.argv.slice(2)
if (!url || !directory) throw new TypeError('Supply the built-site URL and evidence directory')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []

async function check(name, drive) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null
    Object.defineProperty(navigator, 'gpu', { value: undefined })
  })
  try {
    await drive(page)
    assert.deepEqual(errors, [])
    results.push({ name, passed: true })
  } catch (cause) {
    results.push({ name, passed: false, message: String(cause), errors })
  } finally {
    await page.locator('.screen').screenshot({ path: `${directory}/${name}.png` })
    await context.close()
  }
}

async function shellWorks(page) {
  await page.waitForFunction(() =>
    document.querySelector('#terminal').textContent.includes('bash in your browser tab'),
  )
  const inputState = {
    accessibility: await page.locator('#terminal .ghostty-webgpu-accessibility').count(),
    liveRegions: await page.locator('#terminal [aria-live=polite]').count(),
    focused: await page.evaluate(() => document.activeElement?.matches('#terminal textarea')),
  }
  assert.deepEqual(
    inputState,
    { accessibility: 1, liveRegions: 1, focused: true },
    'Input demos enable accessibility and focus the terminal during startup',
  )
  await page.keyboard.type('echo boot-regression-$((6*7))')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document.querySelector('#terminal').textContent.includes('boot-regression-42'),
  )
}

try {
  for (const asset of ['404', 'invalid-gzip']) {
    await check(`frames-${asset}`, async (page) => {
      await page.route('**/ghost-frames.txt.gz', (route) =>
        route.fulfill({
          status: asset === '404' ? 404 : 200,
          body: asset === '404' ? 'unavailable' : Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
        }),
      )
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(
        () => performance.getEntriesByName('ghost:open-resolved').length > 0,
        undefined,
        { timeout: 5000 },
      )
      await page.waitForFunction(() => !document.querySelector('#ghost-first-frame'))
      await page.waitForFunction(() =>
        document.querySelector('#terminal').textContent.includes('The ghost did not load.'),
      )
      await page.locator('.screen').screenshot({ path: `${directory}/frames-${asset}-ghost.png` })
      await page.locator('#tabs button[data-demo=shell]').click()
      await shellWorks(page)
    })
  }
  await check('shell-selected-during-boot', async (page) => {
    let release
    const waiting = new Promise((resolve) => {
      release = resolve
    })
    await page.route('**/ghostty-vt.wasm', async (route) => {
      await waiting
      await route.continue()
    })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => performance.getEntriesByName('ghost:create-start').length > 0)
    await page.locator('#tabs button[data-demo=shell]').click()
    assert.equal(
      await page.locator('#tabs button[data-demo=shell]').getAttribute('aria-selected'),
      'true',
    )
    assert.equal(await page.locator('#ghost-first-frame').count(), 1)
    release()
    await page.waitForFunction(() => !document.querySelector('#ghost-first-frame'))
    await shellWorks(page)
  })
} finally {
  await writeFile(`${directory}/verification.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
assert.equal(
  results.every((result) => result.passed),
  true,
  'Every boot regression passes',
)
