import { expect } from '@playwright/test'
import { fail } from './errors.mjs'
import { correlateInputEvents } from './input-correlation.mjs'
import { startHostCpuEstimate } from './host-contention.mjs'
import { inputScenarios, inputViewModes } from './input-results.mjs'
import { assertConsumerReadiness } from './input-configurations.mjs'

export const operationsPerSample = {
  typing: 24,
  repeat: 24,
  'composition-update': 12,
  'composition-commit': 12,
  paste: 8,
  undo: 12,
}
const pasteText = 'paste 😀 e\u0301 '.repeat(128)

export async function runInputSuite(browser, result, { newPage, readMemory, smoke }) {
  const unsupported = result.config.unsupportedFixtures ?? []
  const supported = result.manifest.fixtures.filter((fixture) => !unsupported.includes(fixture.id))
  const fixtures = smoke ? supported.slice(0, 1) : supported
  const views = smoke ? ['single'] : inputViewModes
  for (const fixture of fixtures)
    for (const view of views)
      await runGroup(browser, fixture, view, result, { newPage, readMemory, smoke })
}

async function runGroup(browser, fixture, views, result, helpers) {
  for (const scenario of inputScenarios)
    await runIsolatedScenario(browser, fixture, views, scenario, result, helpers)
}

async function runIsolatedScenario(browser, fixture, views, scenario, result, helpers) {
  // Before the browser context exists and after it closes: outside every captured input interval.
  const hostCpu = await startHostCpuEstimate()
  const session = await helpers.newPage(browser)
  const errors = []
  session.page.on('pageerror', (error) => errors.push(error.message))
  let samples
  try {
    await session.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    samples = await runScenarioGroup(session, fixture, views, scenario, result, helpers)
    if (errors.length) fail(`Browser errors: ${errors.join('; ')}`)
  } finally {
    await session.context.close()
  }
  for (const sample of samples)
    result.samples.push({ ...sample, cleanup: { ...sample.cleanup, contextClosed: true } })
  ;(result.hostCpuEstimate ??= []).push({
    fixture: fixture.id,
    views,
    scenario,
    ...(await hostCpu()),
  })
}

async function runScenarioGroup(session, fixture, views, scenario, result, helpers) {
  const repetitions = helpers.smoke ? 1 : result.config.repetitions
  const samples = []
  for (let repetition = -result.config.warmups; repetition < repetitions; repetition++) {
    const sample = await runSample(
      session,
      fixture,
      views,
      scenario,
      repetition,
      result,
      helpers.readMemory,
    )
    if (repetition >= 0) samples.push(sample)
    console.log(
      JSON.stringify({
        event: 'input.sample',
        fixture: fixture.id,
        views,
        scenario,
        repetition,
        dispatchMaxMs: Math.max(...sample.latencyMs.dispatch),
      }),
    )
  }
  return samples
}

export async function runSample(
  { page, cdp },
  fixture,
  views,
  scenario,
  repetition,
  result,
  readMemory,
  profileInput = (_identity, run) => run(),
) {
  const beforeMemory = await readMemory(cdp)
  const config = result.config
  const count = config.operationsPerSample[scenario]
  const consumerId = config.consumers ?? 'native'
  const facts = await page.evaluate(
    async ({ fixture, seed, diagnostics, multiple, frozen, consumerId }) => {
      const facts = await __stress.prepare(fixture, seed, diagnostics, frozen)
      __stress.open(
        multiple,
        fixture === 'ordinary',
        consumerId === 'native' ? undefined : consumerId,
      )
      return facts
    },
    {
      fixture: fixture.id,
      seed: result.manifest.seed,
      diagnostics: config.diagnostics,
      multiple: views === 'multiple',
      frozen: config.fixtures === 'frozen-hashed-files',
      consumerId,
    },
  )
  if (facts.sha256 !== fixture.sha256) fail('Input fixture hash mismatch')
  if (consumerId === 'native' && fixture.id === 'ordinary')
    await page.waitForFunction(() => __stress.observe().state.initialHighlightStatus === 'painted')
  const opened =
    consumerId === 'native'
      ? null
      : await settleConsumers(page, consumerId, fixture, views, scenario)
  const target = await page.evaluate(
    ({ scenario, slowdownMs, count }) => {
      const target = __stress.inputLatency.prepare(scenario, slowdownMs)
      if (scenario === 'undo') __stress.inputLatency.seedUndo(count)
      return target
    },
    { scenario, slowdownMs: config.slowdownMs, count },
  )
  if (scenario === 'paste')
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasteText)
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)))
  const before = await page.locator('#view-0').screenshot({ animations: 'disabled' })
  let completed
  try {
    await page.evaluate(() => __stress.inputLatency.start())
    const inserted = await profileInput(
      { cdp, fixture: fixture.id, views, scenario, repetition },
      () => sendInput(page, cdp, scenario, count),
    )
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const observation = await page.evaluate(
      ({ inserted, count }) => __stress.inputLatency.finish(inserted, count),
      { inserted, count },
    )
    await page.evaluate(() => __stress.inputLatency.verifyRendered())
    const paint = await observePaint(page, scenario, before, observation)
    await page.evaluate(() => __stress.inputLatency.revealHidden())
    if (views === 'multiple')
      await expect(page.locator('#view-2 [data-editor-virtual-row]').first()).toBeVisible()
    const rendered = await page.evaluate(() => __stress.inputLatency.verifyRendered())
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)))
    const settled = opened
      ? await settleConsumers(page, consumerId, fixture, views, scenario, opened)
      : null
    const diagnostic = await page.evaluate(() => {
      const { diagnostics, droppedDiagnostics } = __stress.observe()
      return { diagnostics, droppedDiagnostics }
    })
    if (diagnostic.droppedDiagnostics) fail('Bounded diagnostic buffer overflowed')
    if (!config.diagnostics && diagnostic.diagnostics.length)
      fail('Disabled diagnostics emitted payloads')
    const events = observation.events
    const correlations = config.diagnostics
      ? correlateInputEvents({
          events,
          diagnostics: diagnostic.diagnostics,
          scenario,
          views,
          documentId: fixture.id,
        })
      : null
    paint.operation = correlations?.at(-1)?.operation ?? null
    paint.revision = observation.revision
    completed = {
      fixture: fixture.id,
      fixtureHash: fixture.sha256,
      views,
      scenario,
      state: 'warm',
      repetition,
      latencyMs: {
        inputToApplied: events.map((event) => event.appliedAt - event.at),
        dispatch: events.map((event) => event.completedAt - event.dispatchAt),
        inputToFrame: events.map((event) => event.frameAt - event.at),
        burstToPaintUpperBound: [paint.completedAt - events[0].at],
      },
      observation: {
        ...observation,
        ...diagnostic,
        target,
        paint,
        rendered,
        correlations,
        ...(opened ? { consumers: { opened, settled } } : {}),
      },
      correct: true,
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'input.failed',
        fixture: fixture.id,
        views,
        scenario,
        message: error.message,
        observed: await page.evaluate(() => {
          const value = __stress.observe()
          return { state: value.state, scroll: value.scroll, geometry: value.geometry }
        }),
      }),
    )
    // NOT-PORTABLE: Failure screenshots are written under /work/tmp/editor-e002.
    await page.screenshot({ path: '/work/tmp/editor-e002/failure.png' }).catch(() => {})
    throw error
  } finally {
    if (scenario.startsWith('composition-'))
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await page.evaluate(() => __stress.dispose())
  }
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  const afterMemory = await readMemory(cdp)
  const cleanup = {
    ...(await page.evaluate(() => __stress.retention())),
    beforeListeners: beforeMemory.jsEventListeners,
    afterListeners: afterMemory.jsEventListeners,
  }
  if (
    cleanup.active ||
    cleanup.hosts ||
    cleanup.pendingFrames ||
    cleanup.liveWorkers ||
    (repetition >= 0 && cleanup.afterListeners > cleanup.beforeListeners)
  )
    fail(`Input cleanup failed: ${JSON.stringify(cleanup)}`)
  return { ...completed, cleanup }
}

async function sendInput(page, cdp, scenario, count) {
  if (scenario === 'typing') {
    await page.keyboard.type('x'.repeat(count))
    return 'x'.repeat(count)
  }
  if (scenario === 'repeat') {
    for (let index = 0; index < count; index++) await page.keyboard.down('x')
    await page.keyboard.up('x')
    return 'x'.repeat(count)
  }
  if (scenario === 'paste') {
    for (let index = 0; index < count; index++) await page.keyboard.press('Control+v')
    return pasteText.repeat(count)
  }
  if (scenario === 'undo') {
    for (let index = 0; index < count; index++) await page.keyboard.press('Control+z')
    return ''
  }
  if (scenario === 'composition-update') {
    for (let index = 0; index < count; index++)
      await cdp.send('Input.imeSetComposition', {
        text: '日'.repeat(index + 1),
        selectionStart: index + 1,
        selectionEnd: index + 1,
      })
    return ''
  }
  for (let index = 0; index < count; index++) {
    await cdp.send('Input.imeSetComposition', { text: '日', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '日' })
  }
  return '日'.repeat(count)
}

async function observePaint(page, scenario, before, observation) {
  const selector =
    scenario === 'composition-update'
      ? '#view-0 .editor-virtualized-composition'
      : `#view-0 [data-editor-virtual-row="${observation.cursor.row}"]`
  const row = page.locator(selector)
  await expect(row).toBeVisible()
  await expect(row).toBeInViewport()
  if (scenario === 'composition-update')
    await expect(row).toHaveText('日'.repeat(observation.events.length))
  const startedAt = await page.evaluate(() => performance.now())
  const screenshot = await page.locator('#view-0').screenshot({ animations: 'disabled' })
  const completedAt = await page.evaluate(() => performance.now())
  const imageChanged = !before.equals(screenshot)
  if (!imageChanged) fail(`No changed pixels after ${scenario}`)
  return { method: 'screenshot-completion-upper-bound', startedAt, completedAt, imageChanged }
}

async function settleConsumers(page, consumerId, fixture, views, scenario, opened = null) {
  const readiness = await page.evaluate(async () => ({
    ...(await __stress.settleConsumers()),
    workers: globalThis.__inputWorkerProof.map((worker) => ({ ...worker })),
  }))
  assertConsumerReadiness(
    readiness,
    consumerId,
    fixture.id,
    fixture.utf16Length,
    views,
    scenario,
    opened,
  )
  return readiness
}
