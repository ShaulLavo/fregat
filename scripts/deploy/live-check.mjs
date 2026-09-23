// Headless check of the deployed page through the mesh. Run by scripts/deploy/mesh.ts;
// exits non-zero on a failure the previous release's check did not already have.
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { attachObserver, observedProblems, serializable } from '../agent/observe.mjs'

const origin = 'https://omarchy.mesh.shaulavo.dev'
const base = `${origin}/platform/`
// A third-party image the chat renders; proves cross-origin isolation still lets favicons load.
const publicFaviconUrl =
  'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fgithub.com&size=32'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string', default: '' },
    out: { type: 'string', default: fileURLToPath(new URL('.', import.meta.url)) },
    release: { type: 'string' },
    target: { type: 'string', default: base },
  },
})

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
})
const observed = attachObserver(page, base)

const report = { release: values.release, target: values.target, failures: [], preexisting: [] }
try {
  await page.goto(values.target, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Window toolbar', { exact: true }).waitFor({ timeout: 45_000 })
  await page.waitForTimeout(8_000)
  const served = await (await page.request.get(`${base}release`)).json()
  const publicFavicon = await page.evaluate(loadImage, publicFaviconUrl)
  const rendered = await page.evaluate(() => ({
    crossOriginIsolated,
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    wallpaperPreloads: [...document.querySelectorAll('link[rel="preload"][as="image"]')].map(
      (link) => link.href,
    ),
    wallpaperHandoff: window.platformBootWallpaper ?? null,
  }))
  await page.screenshot({ path: resolve(values.out, 'live.png') })
  Object.assign(report, {
    finalUrl: page.url(),
    served,
    rendered,
    publicFavicon,
    ...serializable(observed),
  })
  report.failures = failures({ served, rendered, publicFavicon, observed })
} catch (error) {
  report.failures = [`check aborted: ${error.message}`]
  report.body = (
    await page
      .locator('body')
      .innerText()
      .catch(() => '')
  ).slice(0, 1500)
  await page.screenshot({ path: resolve(values.out, 'live-failure.png') }).catch(() => {})
} finally {
  await browser.close()
}

report.preexisting = await baselineFailures(values.baseline)
const fresh = report.failures.filter((failure) => !report.preexisting.includes(failure))
await writeFile(resolve(values.out, 'live-check.json'), `${JSON.stringify(report, null, 2)}\n`)
for (const failure of report.failures) {
  const tag = fresh.includes(failure) ? 'FAIL' : 'known'
  console.log(`[live] ${tag}: ${failure}`)
}
console.log(
  `[live] ${fresh.length === 0 ? 'passed' : `${fresh.length} new failure(s)`} — ${values.out}/live-check.json`,
)
process.exit(fresh.length === 0 ? 0 : 1)

function failures({ served, rendered, publicFavicon, observed }) {
  const found = []
  if (values.release && served.release !== values.release)
    found.push(`served release is ${served.release}, expected ${values.release}`)
  found.push(...observedProblems(observed))
  if (!rendered.crossOriginIsolated) found.push('page is not cross-origin isolated')
  if (!(publicFavicon.width > 0)) found.push('public favicon did not load')
  if (rendered.wallpaperPreloads.length !== 1)
    found.push(`wallpaper preloads: ${rendered.wallpaperPreloads.length}`)
  if (rendered.wallpaperHandoff?.href !== rendered.wallpaperPreloads[0])
    found.push('the boot wallpaper record does not name the preloaded image')
  // Plan 106: boot is entry + runtime + stylesheet; everything else loads after first paint.
  if (observed.assets.size < 3) found.push(`only ${observed.assets.size} boot assets loaded`)
  if (!observed.apiResponses.some((item) => item.url === `${base}health` && item.status === 200))
    found.push('no successful /health response')
  if (!observed.sockets.some((item) => item.receivedFrames > 0))
    found.push('no websocket received a frame')
  return found
}

async function baselineFailures(file) {
  if (!file) return []
  try {
    const previous = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(previous.failures) ? previous.failures : []
  } catch {
    return []
  }
}

async function loadImage(source) {
  const image = new Image()
  const loaded = new Promise((done) => {
    image.onload = () => done(true)
    image.onerror = () => done(false)
  })
  image.src = source
  await loaded
  return { source: image.src, width: image.naturalWidth }
}
