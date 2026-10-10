// Headless check of the deployed page through the mesh. Run by scripts/install-release.ts, or after a
// restart by the promotion step; exits non-zero on a failure the previous release's check lacked.
// --backend-release supplies built terminal artifacts; installation defaults it to --out.
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { attachObserver, observedProblems, serializable } from '../agent/observe.mjs'
import { readRefusals, refusalFailures } from './live-refusals.mjs'
import { liveVerdict } from './live-verdict.mjs'
import { openLiveBrowser } from './live-browser.mjs'
import { appearanceFailures, inspectAppearance } from './live-appearance.mjs'
import { runLiveProcess } from './live-process.mjs'
import { emptyWorkbenchUrl } from './live-terminal.mjs'

// A third-party image the chat renders; proves cross-origin isolation still lets favicons load.
const publicFaviconUrl =
  'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fgithub.com&size=32'

const { values } = parseArgs({
  options: {
    'backend-release': { type: 'string' },
    baseline: { type: 'string', default: '' },
    logs: { type: 'string', default: '' },
    out: { type: 'string', default: fileURLToPath(new URL('.', import.meta.url)) },
    release: { type: 'string' },
    target: { type: 'string' },
    'wait-for-server': { type: 'string', default: '0' },
  },
})

if (!values.target) {
  console.error('[live] Pass --target=<deployed-page-url>.')
  process.exit(1)
}
const target = URL.parse(values.target)
if (
  !target ||
  !['http:', 'https:'].includes(target.protocol) ||
  target.username ||
  target.password ||
  values.target.includes('?') ||
  values.target.includes('#')
) {
  console.error(
    '[live] The target must be an HTTP or HTTPS page URL without credentials, query or fragment.',
  )
  process.exit(1)
}
const base = `${target.href.replace(/\/$/, '')}/`

const report = { release: values.release, target: base, failures: [], preexisting: [] }
const startedAt = new Date().toISOString()
// The connection gate and a failed boot both render this frame in place of the workbench.
const errorFrame = '[data-slot="status-frame"][data-tone="error"]'
const controller = new AbortController()
let browser
const cancel = (signal) => {
  controller.abort(signal)
  void browser?.close().catch(() => {})
}
const onTerm = () => cancel('SIGTERM')
const onInt = () => cancel('SIGINT')
process.on('SIGTERM', onTerm)
process.on('SIGINT', onInt)
try {
  const waitMs = Number(values['wait-for-server'])
  if (waitMs > 0 && !(await serverReports(values.release, waitMs))) {
    report.failures = [`server did not report ${values.release} within ${waitMs}ms`]
    await finish([])
  }

  const live = await openLiveBrowser(chromium, process.platform, controller.signal)
  browser = live.browser
  controller.signal.throwIfAborted()
  const { page } = live
  const observed = attachObserver(page, base)

  try {
    // Keep saved owner workspaces and terminals out of the target-page check.
    await page.goto(emptyWorkbenchUrl(base), { waitUntil: 'domcontentloaded' })
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
        clientRelease: document.querySelector('meta[name="platform-release"]')?.content ?? null,
      }),
      errorFrame,
    )
    rendered.appearance = await page.evaluate(inspectAppearance)
    await page.screenshot({ path: resolve(values.out, 'live.png') })
    Object.assign(report, {
      finalUrl: page.url(),
      served,
      rendered,
      publicFavicon,
    })
    report.failures = failures({ served, rendered, publicFavicon, observed })
  } catch (error) {
    report.failures = [`check aborted: ${error?.message ?? String(error)}`]
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
  Object.assign(report, serializable(observed))
  report.failures.push(
    ...observedProblems({
      ...observed,
      loopbackRequests: observed.loopbackRequests.filter(
        (url) => new URL(url).origin !== target.origin,
      ),
    }),
  )

  try {
    const { stdout } = await runLiveProcess(
      'bun',
      [
        fileURLToPath(new URL('./live-terminal-check.ts', import.meta.url)),
        base,
        values.out,
        resolve(values['backend-release'] ?? values.out),
      ],
      { signal: controller.signal, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    )
    report.terminal = JSON.parse(stdout)
    report.failures.push(...report.terminal.failures)
  } catch (error) {
    report.failures.push(`terminal check: aborted: ${error?.message ?? String(error)}`)
  }

  report.logNoise = await logNoise(values.logs)
  // Shared logs include old tabs and earlier releases. Retain the census as diagnostics;
  // only evidence from this check decides whether the candidate works.
  for (const warning of report.logNoise.failures) console.log(`[live] diagnostic: ${warning}`)
  try {
    report.refusals = await readRefusals(values.logs, { release: values.release, since: startedAt })
    report.failures.push(...refusalFailures(report.refusals, values.release))
  } catch (error) {
    report.failures.push(`refusal log scan did not run: ${error?.message ?? String(error)}`)
  }
  report.preexisting = await baselineFailures(values.baseline)
  controller.signal.throwIfAborted()
  await finish(report.preexisting)
} catch (error) {
  report.failures.push(`check aborted: ${error?.message ?? String(error)}`)
  await browser?.close()
  await finish([])
} finally {
  process.off('SIGTERM', onTerm)
  process.off('SIGINT', onInt)
}

// Writes the report with its verdict; the server reads status, checkedAt and fresh.
async function finish(preexisting) {
  if (controller.signal.aborted)
    report.failures.push(`check cancelled: ${String(controller.signal.reason)}`)
  const verdict = liveVerdict(report, preexisting)
  const { fresh } = verdict
  Object.assign(report, {
    ...verdict,
    checkedAt: new Date().toISOString(),
  })
  await writeFile(resolve(values.out, 'live-check.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (controller.signal.aborted && report.status === 'passed') return finish([])
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
    controller.signal.throwIfAborted()
    if ((await servedServerRelease()) === release) return true
    await new Promise((done) => setTimeout(done, 1_000))
  }
  return false
}

async function servedServerRelease() {
  try {
    const response = await fetch(`${base}release`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
    })
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
  if (values.release && rendered.clientRelease !== values.release)
    found.push(`loaded client release is ${rendered.clientRelease}, expected ${values.release}`)
  if (rendered.errorFrame)
    found.push(
      `page shows an error frame on ${values.release ?? 'this release'}: ${rendered.errorFrame}`,
    )
  if (!rendered.crossOriginIsolated) found.push('page is not cross-origin isolated')
  if (!(publicFavicon.width > 0)) found.push('public favicon did not load')
  found.push(...appearanceFailures(rendered.appearance))
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
    const failures = Array.isArray(previous.failures) ? previous.failures : []
    return failures
  } catch {
    return []
  }
}

// The census over the last 24 hours of production logs (AGENTS.md "Logs").
async function logNoise(directory) {
  if (!directory) return { failures: [], groups: [] }
  const census = fileURLToPath(new URL('../lint/log-noise-census.ts', import.meta.url))
  try {
    const { stdout } = await runLiveProcess(
      'bun',
      [census, `--dir=${directory}`, '--since=24h', '--json'],
      { signal: controller.signal, maxBuffer: 64 * 1024 * 1024 },
    )
    const result = JSON.parse(stdout)
    const groups = result.failures.map(({ key, count, reasons }) => ({ key, count, reasons }))
    return {
      failures: groups
        .map((group) => `log noise: ${group.key}`)
        .concat(result.allowProblems.map((problem) => `log noise allow list: ${problem}`)),
      groups,
    }
  } catch (error) {
    return { failures: [`log census did not run: ${error?.message ?? String(error)}`], groups: [] }
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
