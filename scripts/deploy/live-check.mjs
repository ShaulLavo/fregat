// Headless check of the deployed page through the mesh. Run by scripts/deploy/mesh.ts, or after a
// restart by the promotion step; exits non-zero on a failure the previous release's check lacked.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs, promisify } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { attachObserver, observedProblems, serializable } from '../agent/observe.mjs'
import { readRefusals, refusalFailures } from './live-refusals.mjs'

const origin = 'https://omarchy.mesh.shaulavo.dev'
const base = `${origin}/platform/`
// A third-party image the chat renders; proves cross-origin isolation still lets favicons load.
const publicFaviconUrl =
  'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fgithub.com&size=32'

const { values } = parseArgs({
  options: {
    baseline: { type: 'string', default: '' },
    logs: { type: 'string', default: '' },
    out: { type: 'string', default: fileURLToPath(new URL('.', import.meta.url)) },
    release: { type: 'string' },
    target: { type: 'string', default: base },
    'wait-for-server': { type: 'string', default: '0' },
  },
})

const report = { release: values.release, target: values.target, failures: [], preexisting: [] }
const startedAt = new Date().toISOString()
// The connection gate and a failed boot both render this frame in place of the workbench.
const errorFrame = '[data-slot="status-frame"][data-tone="error"]'
const waitMs = Number(values['wait-for-server'])
if (waitMs > 0 && !(await serverReports(values.release, waitMs))) {
  report.failures = [`server did not report ${values.release} within ${waitMs}ms`]
  await finish([])
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
})
const observed = attachObserver(page, base)

try {
  await page.goto(values.target, { waitUntil: 'domcontentloaded' })
  await page
    .locator(`[aria-label="Window toolbar"], ${errorFrame}`)
    .first()
    .waitFor({ timeout: 45_000 })
  await page.waitForTimeout(8_000)
  const served = await (await page.request.get(`${base}release`)).json()
  const publicFavicon = await page.evaluate(loadImage, publicFaviconUrl)
  const rendered = await page.evaluate(
    (errorFrame) => ({
      crossOriginIsolated,
      errorFrame: document.querySelector(errorFrame)?.textContent ?? null,
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      wallpaperPreloads: [...document.querySelectorAll('link[rel="preload"][as="image"]')].map(
        (link) => link.href,
      ),
      wallpaperHandoff: window.platformBootWallpaper ?? null,
    }),
    errorFrame,
  )
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

report.logNoise = await logNoise(values.logs)
report.failures.push(...report.logNoise.failures)
try {
  report.refusals = await readRefusals(values.logs, { release: values.release, since: startedAt })
  report.failures.push(...refusalFailures(report.refusals, values.release))
} catch (error) {
  report.failures.push(`refusal log scan did not run: ${error.message}`)
}
report.preexisting = await baselineFailures(values.baseline, report.logNoise.failures)
await finish(report.preexisting)

// Writes the report with its verdict; the server reads status, checkedAt and fresh.
async function finish(preexisting) {
  const fresh = report.failures.filter((failure) => !preexisting.includes(failure))
  Object.assign(report, {
    status: fresh.length === 0 ? 'passed' : 'failed',
    checkedAt: new Date().toISOString(),
    fresh,
  })
  await writeFile(resolve(values.out, 'live-check.json'), `${JSON.stringify(report, null, 2)}\n`)
  for (const failure of report.failures) {
    const tag = fresh.includes(failure) ? 'FAIL' : 'known'
    console.log(`[live] ${tag}: ${failure}`)
  }
  console.log(
    `[live] ${fresh.length === 0 ? 'passed' : `${fresh.length} new failure(s)`} — ${values.out}/live-check.json`,
  )
  process.exit(fresh.length === 0 ? 0 : 1)
}

// After a restart the check waits until the new server answers through the mesh.
async function serverReports(release, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await servedServerRelease()) === release) return true
    await new Promise((done) => setTimeout(done, 1_000))
  }
  return false
}

async function servedServerRelease() {
  try {
    const response = await fetch(`${base}release`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    return (await response.json()).server?.release ?? null
  } catch {
    return null
  }
}

function failures({ served, rendered, publicFavicon, observed }) {
  const found = []
  if (values.release && served.release !== values.release)
    found.push(`served release is ${served.release}, expected ${values.release}`)
  found.push(...observedProblems(observed))
  if (rendered.errorFrame)
    found.push(
      `page shows an error frame on ${values.release ?? 'this release'}: ${rendered.errorFrame}`,
    )
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

// A previous check without a log census has no noise baseline, so today's noise counts as known.
async function baselineFailures(file, noise) {
  if (!file) return []
  try {
    const previous = JSON.parse(await readFile(file, 'utf8'))
    const failures = Array.isArray(previous.failures) ? previous.failures : []
    return previous.logNoise ? failures : [...failures, ...noise]
  } catch {
    return []
  }
}

// The census over the last 24 hours of production logs (AGENTS.md "Logs").
async function logNoise(directory) {
  if (!directory) return { failures: [], groups: [] }
  const census = fileURLToPath(new URL('../lint/log-noise-census.ts', import.meta.url))
  try {
    const { stdout } = await promisify(execFile)(
      'bun',
      [census, `--dir=${directory}`, '--since=24h', '--json'],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    const result = JSON.parse(stdout)
    const groups = result.failures.map(({ key, count, reasons }) => ({ key, count, reasons }))
    return {
      failures: [
        ...groups.map((group) => `log noise: ${group.key}`),
        ...result.allowProblems.map((problem) => `log noise allow list: ${problem}`),
      ],
      groups,
    }
  } catch (error) {
    return { failures: [`log census did not run: ${error.message}`], groups: [] }
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
