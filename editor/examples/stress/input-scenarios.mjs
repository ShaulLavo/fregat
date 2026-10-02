import { expect } from '@playwright/test'
import { fail } from './errors.mjs'
import { correlateInputEvents } from './input-correlation.mjs'
import { startHostCpuEstimate } from './host-contention.mjs'
import { inputScenarios, inputViewModes } from './input-results.mjs'
import { inputPairOrder } from './input-paired.mjs'
import { canStopInputPairs } from './input-pair-stopping.mjs'
import { assertConsumerReadiness } from './input-output.mjs'
import { inputReadinessTimeoutMs } from './src/inputReadiness.ts'

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

export async function runPairedInputSuite(browser, results, helpers, seed) {
  const sessions = {}
  return withInputSessionCleanup(sessions, results, helpers.readMemory, () =>
    collectPairedInputSuite(browser, results, helpers, seed, sessions),
  )
}

async function collectPairedInputSuite(browser, results, helpers, seed, sessions) {
  const schedule = []
  const errors = []
  for (const side of ['baseline', 'candidate']) {
    const session = await helpers.newPage(browser, side)
    sessions[side] = session
    session.page.on('pageerror', (error) => errors.push(error.message))
    await session.context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await initializeInputSession(session, results[side], helpers.readMemory)
    session.retainedInput = { beforeMemory: await helpers.readMemory(session.cdp) }
    results[side].startup = []
  }
  for (const views of inputViewModes)
    await runWarmView(results, helpers, sessions, views, seed, schedule)
  if (errors.length) fail(`Browser errors: ${errors.join('; ')}`)
  return schedule
}

export async function withInputSessionCleanup(sessions, results, readMemory, run) {
  let value
  let failure = null
  try {
    value = await run()
  } catch (error) {
    failure = { error }
  }
  const cleanup = await Promise.allSettled(
    Object.entries(sessions).map(async ([side, session]) => {
      results[side].cleanup = await closeInputSession(session, readMemory)
      if (results[side].bootstrap)
        results[side].bootstrap.cleanup.contextClosed = session.page.isClosed()
    }),
  )
  if (failure) throw failure.error
  const rejected = cleanup.find((entry) => entry.status === 'rejected')
  if (rejected) throw rejected.reason
  return value
}

async function initializeInputSession(session, result, readMemory) {
  const fixture = result.manifest.fixtures.find((entry) => entry.id === 'ordinary')
  // Initialize both Playwright worlds and page-scoped worker owners before lifetime accounting.
  result.bootstrap = await runSample(
    session,
    fixture,
    'single',
    'typing',
    -1,
    {
      ...result,
      config: { ...result.config, isolation: 'closed-browser-context-per-fixture-view-scenario' },
    },
    readMemory,
  )
}

async function runWarmView(results, helpers, sessions, views, seed, schedule) {
  for (const fixture of results.baseline.manifest.fixtures) {
    for (const side of ['baseline', 'candidate']) {
      const session = sessions[side]
      const started = performance.now()
      const facts = await session.page.evaluate(
        ({ fixture, seed, diagnostics, frozen, multiple, consumerId }) =>
          __stress.warmInputSubject(fixture, seed, diagnostics, frozen, multiple, consumerId),
        {
          fixture: fixture.id,
          seed: results[side].manifest.seed,
          diagnostics: results[side].config.diagnostics,
          frozen: true,
          multiple: views === 'multiple',
          consumerId: results[side].config.consumers,
        },
      )
      if (facts.sha256 !== fixture.sha256) fail('Warm subject fixture hash mismatch')
      session.retainedInput.facts = facts
      session.retainedInput.needsReload = false
      session.retainedInput.reloadSource = null
      if (results[side].config.consumers !== 'native')
        await settleConsumers(
          session.page,
          results[side].config.consumers,
          fixture,
          views,
          'typing',
        )
      else if (fixture.id === 'ordinary')
        await session.page.waitForFunction(
          () => __stress.observe().state.initialHighlightStatus === 'painted',
        )
      results[side].startup.push({
        fixture: fixture.id,
        views,
        retained: facts.retained,
        milliseconds: performance.now() - started,
        ownerIdentity: facts.ownerIdentity,
      })
    }
    for (const scenario of inputScenarios)
      await runPairedGroup(results, helpers, sessions, fixture, views, scenario, seed, schedule)
  }
}

async function runPairedGroup(
  results,
  helpers,
  sessions,
  fixture,
  views,
  scenario,
  seed,
  schedule,
) {
  const samples = { baseline: [], candidate: [] }
  const config = results.baseline.config
  for (let repetition = -config.warmups; repetition < config.repetitions; repetition++) {
    const group = `${fixture.id}/${views}/${scenario}`
    const order = inputPairOrder(seed, group, repetition)
    const pair = { group, repetition, order }
    for (const side of order) {
      const sample = await runSample(
        sessions[side],
        fixture,
        views,
        scenario,
        repetition,
        results[side],
        helpers.readMemory,
      )
      if (repetition >= 0) samples[side].push(sample)
      console.log(
        JSON.stringify({
          event: 'input.paired.sample',
          ...pair,
          sampleFixture: sample.fixture,
          side,
          dispatchMaxMs: Math.max(...sample.latencyMs.dispatch),
          wallPhasesMs: sample.wallPhasesMs,
        }),
      )
    }
    if (repetition >= 0) schedule.push(pair)
    if (
      config.adaptivePairs &&
      repetition === 1 &&
      canStopInputPairs(samples, config.consumers, config.loadProfile)
    )
      break
  }
  for (const side of ['baseline', 'candidate']) {
    if (results[side].config.adaptivePairs)
      results[side].config.groupRepetitions[`${fixture.id}/${views}/${scenario}`] =
        samples[side].length
    results[side].samples.push(...samples[side])
  }
}

async function openInputSample(session, fixture, views, result, retained) {
  const { page } = session
  if (retained) {
    if (session.retainedInput.facts.sha256 !== fixture.sha256)
      fail('Retained input fixture changed')
    const started = performance.now()
    let reset = await page.evaluate(() => __stress.resetInput())
    const documentReloaded = session.retainedInput.needsReload === true
    if (documentReloaded) reset = await page.evaluate(() => __stress.reloadInputDocument())
    const rejectedSource = documentReloaded ? session.retainedInput.reloadSource : null
    session.retainedInput.needsReload = false
    session.retainedInput.reloadSource = null
    return {
      facts: session.retainedInput.facts,
      reset: {
        ...reset,
        documentReloaded,
        rejectedSource,
        milliseconds: performance.now() - started,
      },
    }
  }
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
      diagnostics: result.config.diagnostics,
      multiple: views === 'multiple',
      frozen: result.config.fixtures === 'frozen-hashed-files',
      consumerId: result.config.consumers ?? 'native',
    },
  )
  return { facts, reset: null }
}

async function closeInputSession(session, readMemory) {
  try {
    await session.page.evaluate(() => __stress.dispose())
    if (!session.retainedInput) return null
    await session.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    const afterMemory = await readMemory(session.cdp)
    const cleanup = {
      ...(await session.page.evaluate(() => __stress.retention())),
      beforeListeners: session.retainedInput.beforeMemory.jsEventListeners,
      afterListeners: afterMemory.jsEventListeners,
      scope: 'configuration',
      ownerIdentity: session.retainedInput.facts?.ownerIdentity ?? null,
      contextClosed: true,
    }
    if (
      cleanup.active ||
      cleanup.hosts ||
      cleanup.pendingFrames ||
      cleanup.liveWorkers ||
      cleanup.afterListeners > cleanup.beforeListeners
    )
      fail(`Input lifetime cleanup failed: ${JSON.stringify(cleanup)}`)
    return cleanup
  } finally {
    await session.context.close()
  }
}

export async function runSample(
  session,
  fixture,
  views,
  scenario,
  repetition,
  result,
  readMemory,
  profileInput = (_identity, run) => run(),
) {
  const { page, cdp } = session
  const wallStarted = performance.now()
  const wallPhasesMs = {}
  let wallPrevious = wallStarted
  const phase = (name) => {
    const now = performance.now()
    wallPhasesMs[name] = now - wallPrevious
    wallPrevious = now
  }
  const beforeMemory = await readMemory(cdp)
  phase('beforeMemory')
  const config = result.config
  const count = config.operationsPerSample[scenario]
  const consumerId = config.consumers ?? 'native'
  const retained = config.isolation === 'closed-browser-context-per-configuration'
  const { facts, reset } = await openInputSample(session, fixture, views, result, retained)
  if (facts.sha256 !== fixture.sha256) fail('Input fixture hash mismatch')
  if (consumerId === 'native' && fixture.id === 'ordinary')
    await page.waitForFunction(() => __stress.observe().state.initialHighlightStatus === 'painted')
  // Reset source updates can follow acceptance of the prior render; require the current source.
  const readySource =
    config.readiness === 'receipt-poll' && consumerId !== 'native'
      ? await waitForConsumerSource(page)
      : null
  const opened =
    consumerId === 'native'
      ? null
      : await settleConsumers(page, consumerId, fixture, views, scenario, null, false, readySource)
  phase('openAndConsumers')
  const target = await page.evaluate(
    ({ scenario, slowdownMs, frameSlowdownMs, count }) => {
      const target = __stress.inputLatency.prepare(scenario, slowdownMs, frameSlowdownMs)
      if (scenario === 'undo') __stress.inputLatency.seedUndo(count)
      return target
    },
    {
      scenario,
      slowdownMs: config.slowdownMs,
      frameSlowdownMs: config.frameSlowdownMs ?? 0,
      count,
    },
  )
  if (scenario === 'paste')
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasteText)
  if (config.readiness === 'receipt-poll' && scenario === 'undo' && opened) {
    // Undo starts from the seeded worker source; a fixed delay can leave its parse pending.
    await waitForConsumerSource(page)
  } else if (config.readiness !== 'receipt-poll' || scenario === 'undo') {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)))
  }
  const before = await page.locator('#view-0').screenshot({ animations: 'disabled' })
  phase('primeAndScreenshot')
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
    phase('inputAndPaint')
    if (config.readiness !== 'receipt-poll')
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)))
    const readiness =
      config.readiness === 'receipt-poll' && opened
        ? await waitForConsumerSource(
            page,
            config.pendingMinimapSource && fixture.id === 'short-lines' && scenario === 'undo',
          )
        : null
    const settled = opened
      ? await settleConsumers(
          page,
          consumerId,
          fixture,
          views,
          scenario,
          opened,
          config.pendingMinimapSource,
          readiness,
        )
      : null
    if (retained && settled?.minimaps.some((minimap) => !minimap.current)) {
      if (!config.pendingMinimapSource || fixture.id !== 'short-lines' || scenario !== 'undo')
        fail('Unexpected retained minimap source mismatch')
      session.retainedInput.needsReload = true
      session.retainedInput.reloadSource = settled.minimaps
    }
    phase('settleConsumers')
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
      ...(retained
        ? {
            reset: {
              ...reset,
              fixtureHash: facts.sha256,
              sourceCurrent:
                !opened ||
                (opened.sessions.every((source) => source.current && source.answered) &&
                  opened.minimaps.every((source) => source.current)),
            },
          }
        : {}),
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
    // NOT-PORTABLE: Failure screenshots default to /work/tmp/editor-e002.
    await page
      .screenshot({ path: `${config.failureDirectory ?? '/work/tmp/editor-e002'}/failure.png` })
      .catch(() => {})
    throw error
  } finally {
    if (scenario.startsWith('composition-'))
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await page.evaluate((retained) => {
      if (retained) return __stress.inputLatency.dispose()
      return __stress.dispose()
    }, retained)
  }
  phase(retained ? 'releaseInput' : 'disposeAndDiagnostics')
  if (retained)
    return { ...completed, cleanup: null, wallPhasesMs, wallMs: performance.now() - wallStarted }
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
  phase('cleanupAndMemory')
  return { ...completed, cleanup, wallPhasesMs, wallMs: performance.now() - wallStarted }
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

async function settleConsumers(
  page,
  consumerId,
  fixture,
  views,
  scenario,
  opened = null,
  pendingMinimapSource = false,
  observed = null,
) {
  const readiness = observed ?? (await readConsumerReadiness(page))
  assertConsumerReadiness(
    readiness,
    consumerId,
    fixture.id,
    fixture.utf16Length,
    views,
    scenario,
    opened,
    pendingMinimapSource,
  )
  return readiness
}

async function readConsumerReadiness(page) {
  return page.evaluate(async () => ({
    ...(await __stress.settleConsumers()),
    workers: globalThis.__inputWorkerProof.map((worker) => ({ ...worker })),
  }))
}

export async function waitForConsumerSource(page, pendingMinimapSource = false) {
  let readiness
  // Await the browser transport; an async waitForFunction predicate is immediately truthy.
  await expect
    .poll(
      async () => {
        readiness = await readConsumerReadiness(page)
        return (
          readiness.sessions.every((session) => session.current && session.answered) &&
          readiness.minimaps.every(
            (minimap) => (minimap.current || pendingMinimapSource) && minimap.renderedAfterSource,
          )
        )
      },
      { timeout: inputReadinessTimeoutMs, intervals: [50] },
    )
    .toBe(true)
  return readiness
}
