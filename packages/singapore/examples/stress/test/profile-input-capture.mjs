import { parseArgs } from 'node:util'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { chromium } from '@playwright/test'
import { loadPackageSet } from '../package-set.mjs'
import { readFrozenManifest } from '../fixtures.mjs'
import { buildInputRuntime, inputInstrument, inputPage, inputMemory } from '../input-runtime.mjs'
import { captureInputView } from '../input-capture.mjs'
import { fail } from '../errors.mjs'

const { values } = parseArgs({
  options: {
    packages: { type: 'string' },
    fixtures: { type: 'string' },
    output: { type: 'string' },
    iterations: { type: 'string', default: '20' },
  },
})
const iterations = Number(values.iterations)
if (
  !values.packages ||
  !values.fixtures ||
  !values.output ||
  !Number.isSafeInteger(iterations) ||
  iterations < 2 ||
  iterations % 2 !== 0
)
  fail('Expected --packages, --fixtures, --output and at least two iterations')
const output = resolve(values.output)
await mkdir(output, { recursive: true })
const temporary = await mkdtemp(join(tmpdir(), 'input-capture-profile-'))
const packageSet = await loadPackageSet(values.packages)
let browser
let session
const samples = []
let cleanup
try {
  const fixtures = resolve(values.fixtures)
  const manifest = await readFrozenManifest(fixtures)
  browser = await chromium.launch({ headless: true })
  const instrument = await inputInstrument({
    runner: process.version,
    browser: { engine: 'chromium', version: browser.version(), headless: true },
  })
  const runtime = await buildInputRuntime(
    packageSet,
    resolve(temporary, 'runtime'),
    fixtures,
    manifest,
    instrument,
  )
  session = await inputPage(browser, runtime, 'disabled')
  await session.page.evaluate(() =>
    __stress.warmInputSubject('ordinary', 60061, false, true, false, 'disabled'),
  )
  for (let iteration = -1; iteration < iterations; iteration++) {
    const images = {}
    const durations = {}
    const order = iteration % 2 === 0 ? ['element', 'clipped'] : ['clipped', 'element']
    for (const method of order) {
      const started = performance.now()
      images[method] =
        method === 'element'
          ? await session.page.locator('#view-0').screenshot({ animations: 'disabled' })
          : await captureInputView(session.page)
      durations[method] = performance.now() - started
    }
    if (!images.element.equals(images.clipped))
      fail('Screenshot pixels differ between capture paths')
    if (iteration >= 0) samples.push({ iteration, order, durationsMs: durations })
    await writeFile(resolve(output, 'element.png'), images.element)
    await writeFile(resolve(output, 'clipped.png'), images.clipped)
  }
  await session.page.evaluate(() => __stress.dispose())
  await inputMemory(session.cdp)
  cleanup = await session.page.evaluate(() => __stress.retention())
  if (cleanup.retainedObjects || cleanup.hosts || cleanup.pendingFrames || cleanup.liveWorkers)
    fail('Capture profile retained its browser resources')
  await session.context.close()
  cleanup.contextClosed = session.page.isClosed()
  await writeFile(
    resolve(output, 'profile.json'),
    JSON.stringify(
      {
        kind: 'paired-screenshot-overhead-profile',
        acceptanceEligible: false,
        packages: { sourceHash: packageSet.sourceHash, buildHash: packageSet.buildHash },
        instrument: {
          measurementHash: instrument.measurementHash,
          validationHash: instrument.validationHash,
        },
        browser: { version: browser.version(), headless: true },
        samples,
        identicalPng: true,
        cleanup,
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  await session?.context.close()
  await browser?.close()
  await rm(temporary, { recursive: true, force: true })
}
