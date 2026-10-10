// Reload the built landing page with cold fonts and a delayed player, including a mobile
// viewport-height change. Browser routes serve the assets without a background server.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, webkit } from 'playwright'

const { values } = parseArgs({
  options: {
    engine: { type: 'string', default: 'webkit' },
    headed: { type: 'boolean', default: false },
    dist: { type: 'string', default: resolve(import.meta.dirname, '../dist') },
    evidence: { type: 'string' },
  },
})
assert.ok(values.engine === 'webkit' || values.engine === 'chromium')
const evidence = values.evidence
if (evidence) await mkdir(evidence, { recursive: true })
const browser = await (values.engine === 'webkit' ? webkit : chromium).launch({
  headless: !values.headed,
})
const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
}
const failures: string[] = []
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  })
  await context.route('http://site.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/fregat\/?/, '')
    const file = Bun.file(join(values.dist!, path || 'index.html'))
    if (!(await file.exists())) return route.fulfill({ status: 404 })
    const extension = extname(file.name!)
    if (extension === '.woff2') await Bun.sleep(600)
    if (extension === '.js') await Bun.sleep(350)
    await route.fulfill({
      body: Buffer.from(await file.arrayBuffer()),
      contentType: types[extension],
    })
  })
  await context.addInitScript(() => {
    const state = {
      samples: [] as { ms: number; y: number; bounds: number[] }[],
      shifts: [] as { ms: number; value: number; replicaOnly: boolean }[],
      wallpapers: [] as boolean[],
      persisted: false,
    }
    let start = 0
    Object.assign(window, { reloadEvidence: state })
    addEventListener('pageshow', (event) => {
      state.persisted = event.persisted
    })
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number
            sources: { node: Node | null }[]
          }
          state.shifts.push({
            ms: shift.startTime - start,
            value: shift.value,
            replicaOnly:
              shift.sources.length > 0 &&
              shift.sources.every(({ node }) => {
                const element = node instanceof Element ? node : node?.parentElement
                return !!element?.closest('.rep')
              }),
          })
        }
      }).observe({ type: 'layout-shift', buffered: true })
    }
    function sample() {
      const hero = document.querySelector('.hero')
      if (
        !hero ||
        getComputedStyle(hero).paddingTop !== '64px' ||
        getComputedStyle(hero).visibility === 'hidden'
      ) {
        requestAnimationFrame(sample)
        return
      }
      const bounds = Array.from(
        document.querySelectorAll(
          '.hero, .hero h1, .hero p, .hero .ctas, .hero-plate, #hero, figure > .plate-cap, #review',
        ),
        (element) => {
          const box = element.getBoundingClientRect()
          return [box.top + scrollY, box.height]
        },
      ).flat()
      if (bounds.length !== 16) {
        requestAnimationFrame(sample)
        return
      }
      if (!start) {
        start = performance.now()
        state.wallpapers = Array.from(document.querySelectorAll('.plate'), (element) => {
          const image = element.querySelector('.wallpaper')
          return (
            getComputedStyle(element).backgroundImage.includes('data:image/webp;base64,') &&
            image instanceof HTMLImageElement &&
            Number(image.getAttribute('width')) > 0 &&
            Number(image.getAttribute('height')) > 0
          )
        })
      }
      const ms = performance.now() - start
      state.samples.push({ ms, y: scrollY, bounds })
      if (ms < 6000) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const page = await context.newPage()
  for (const position of [0, 80, 650]) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('http://site.test/fregat/')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate((y) => scrollTo(0, y), position)
    await page.waitForFunction((y) => Math.abs(scrollY - y) <= 1, position)
    // Let the browser record the scroll event before navigating away.
    await page.waitForTimeout(300)
    for (const height of [844, 664]) {
      await page.setViewportSize({ width: 390, height })
      const expected = await page.evaluate(() => scrollY)
      assert.ok(Math.abs(expected - position) <= 1, 'Resizing preserves the saved position')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => {
        const state = (
          window as typeof window & {
            reloadEvidence: { samples: { ms: number }[] }
          }
        ).reloadEvidence
        return (state.samples.at(-1)?.ms ?? 0) >= 5500
      })
      const state = await page.evaluate(
        () =>
          (
            window as typeof window & {
              reloadEvidence: {
                samples: { ms: number; y: number; bounds: number[] }[]
                shifts: { ms: number; value: number; replicaOnly: boolean }[]
                wallpapers: boolean[]
              }
            }
          ).reloadEvidence,
      )
      assert.ok(
        state.wallpapers.length > 0 && state.wallpapers.every(Boolean),
        'Initial wallpapers include image dimensions and an inline preview',
      )
      const firstSecond = state.samples.filter((sample) => sample.ms <= 1000)
      const first = firstSecond[0]!
      const layoutDrift = Math.max(
        ...firstSecond.flatMap((sample) =>
          sample.bounds.map((bound, index) => Math.abs(bound - first.bounds[index]!)),
        ),
      )
      // The first visible frame must already be restored; a top-frame flash is a failure.
      const restored = state.samples
      const scrollDrift = Math.max(...restored.map((sample) => Math.abs(sample.y - expected)))
      // Playback intentionally moves illustration contents; page layout must stay steady.
      const pageShift = state.shifts
        .filter((shift) => shift.ms >= 0 && shift.ms <= 1000 && !shift.replicaOnly)
        .reduce((total, shift) => total + shift.value, 0)
      const label = `${values.engine}-${position}-${height}`
      console.log(
        `${label}: first-second layout ${layoutDrift.toFixed(2)}px, reload scroll ${scrollDrift.toFixed(2)}px, page CLS ${pageShift.toFixed(6)}`,
      )
      if (evidence)
        await writeFile(
          join(evidence, `${label}.json`),
          JSON.stringify({ expected, layoutDrift, scrollDrift, pageShift, ...state }, null, 2),
        )
      assert.ok(Number.isFinite(layoutDrift) && Number.isFinite(scrollDrift))
      if (layoutDrift !== 0 || scrollDrift !== 0 || pageShift > 0) failures.push(label)
    }
  }
  // A saved reload position must not affect a fresh visit or a fragment destination.
  await page.evaluate(() => scrollTo(0, 400))
  await page.waitForTimeout(300)
  await page.goto('http://site.test/fregat/?fresh=1')
  assert.equal(await page.evaluate(() => scrollY), 0, 'Fresh navigation starts at the top')
  await page.goBack()
  await page.waitForFunction(() => Math.abs(scrollY - 400) <= 1)
  const persisted = await page.evaluate(
    () =>
      (window as typeof window & { reloadEvidence: { persisted: boolean } }).reloadEvidence
        .persisted,
  )
  console.log(`${values.engine}: back navigation preserved 400px; bfcache ${persisted}`)
  if (evidence)
    await writeFile(join(evidence, 'back-navigation.json'), JSON.stringify({ persisted, y: 400 }))
  await page.goto('http://site.test/fregat/#review')
  for (const reload of [false, true]) {
    if (reload) await page.reload()
    await page.waitForFunction(() => {
      const target = document.querySelector('#review')!.getBoundingClientRect().top + scrollY
      return Math.abs(scrollY - target) <= 1
    })
    assert.equal(await page.evaluate(() => history.scrollRestoration), 'auto')
  }
  await page.goto('http://site.test/fregat/?invalid=1')
  await page.addInitScript(() => {
    sessionStorage.setItem(
      `fregat.site.scroll:${location.pathname}`,
      JSON.stringify({ y: 650, height: 10 }),
    )
  })
  await page.reload()
  assert.equal(await page.evaluate(() => scrollY), 0, 'Invalid saved dimensions start at the top')
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).visibility),
    'visible',
  )
  if (evidence) {
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(evidence, `${values.engine}-mobile.png`) })
  }
} finally {
  await browser.close()
}
assert.deepEqual(failures, [], 'Reload preserves scroll position and first-second layout')
