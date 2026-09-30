import type { Browser, BrowserContext, Page, CDPSession } from '@playwright/test'
import type {} from './src/browser.ts'
import { expect } from '@playwright/test'
import { fail } from './errors.ts'
import { correlateInputEvents } from './input-correlation.ts'
import {
  inputScenarios,
  inputViewModes,
  validateInputConfig,
  type InputConfig,
} from './input-results.ts'

import type { createManifest } from './fixtures.ts'
import type { InputScenario } from './src/inputLatency.ts'

type Manifest = ReturnType<typeof createManifest>
type Fixture = Manifest['fixtures'][number]
type Session = { page: Page; cdp: CDPSession; context: BrowserContext }
type SampleContext = {
  manifest: Pick<Manifest, 'seed'>
  config: Pick<InputConfig, 'diagnostics' | 'slowdownMs' | 'operationsPerSample'>
}
export type ClosedInputSample = Omit<Awaited<ReturnType<typeof runSample>>, 'cleanup'> & {
  cleanup: Awaited<ReturnType<typeof runSample>>['cleanup'] & { contextClosed: boolean }
}
type SuiteResult = {
  manifest: Manifest
  config: InputConfig
  samples: { push: (sample: ClosedInputSample) => unknown }
}
type Helpers = {
  newPage: (browser: Browser) => Promise<Session>
  readMemory: (cdp: CDPSession) => Promise<{ jsEventListeners: number }>
  smoke: boolean
}
type ProfileInput = <T>(
  identity: {
    cdp: CDPSession
    fixture: string
    views: string
    scenario: string
    repetition: number
  },
  run: () => Promise<T>,
) => Promise<T>

export const operationsPerSample = {
  typing: 24,
  repeat: 24,
  'composition-update': 12,
  'composition-commit': 12,
  paste: 8,
  undo: 12,
}
const pasteText = 'paste 😀 e\u0301 '.repeat(128)

export async function runInputSuite(
  browser: Browser,
  result: { manifest: Manifest; config: unknown; samples: SuiteResult['samples'] },
  { newPage, readMemory, smoke }: Helpers,
) {
  validateInputConfig(result.config)
  const suite = { manifest: result.manifest, config: result.config, samples: result.samples }
  const fixtures = smoke ? result.manifest.fixtures.slice(0, 1) : result.manifest.fixtures
  const views = smoke ? ['single'] : inputViewModes
  for (const fixture of fixtures)
    for (const view of views)
      await runGroup(browser, fixture, view, suite, { newPage, readMemory, smoke })
}

async function runGroup(
  browser: Browser,
  fixture: Fixture,
  views: string,
  result: SuiteResult,
  helpers: Helpers,
) {
  for (const scenario of inputScenarios)
    await runIsolatedScenario(browser, fixture, views, scenario, result, helpers)
}

async function runIsolatedScenario(
  browser: Browser,
  fixture: Fixture,
  views: string,
  scenario: InputScenario,
  result: SuiteResult,
  helpers: Helpers,
) {
  const session = await helpers.newPage(browser)
  const errors: string[] = []
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
}

async function runScenarioGroup(
  session: Session,
  fixture: Fixture,
  views: string,
  scenario: InputScenario,
  result: SuiteResult,
  helpers: Helpers,
) {
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
  { page, cdp }: Pick<Session, 'page' | 'cdp'>,
  fixture: Fixture,
  views: string,
  scenario: InputScenario,
  repetition: number,
  result: SampleContext,
  readMemory: Helpers['readMemory'],
  profileInput: ProfileInput = (_identity, run) => run(),
) {
  const beforeMemory = await readMemory(cdp)
  const config = result.config
  const count = config.operationsPerSample[scenario]
  const facts = await page.evaluate(
    async ({ fixture, seed, diagnostics, multiple }) => {
      const facts = await __stress.prepare(fixture, seed, diagnostics)
      __stress.open(multiple, fixture === 'ordinary')
      return facts
    },
    {
      fixture: fixture.id,
      seed: result.manifest.seed,
      diagnostics: config.diagnostics,
      multiple: views === 'multiple',
    },
  )
  if (facts.sha256 !== fixture.sha256) fail('Input fixture hash mismatch')
  if (fixture.id === 'ordinary')
    await page.waitForFunction(() => __stress.observe().state.initialHighlightStatus === 'painted')
  const target = await page.evaluate(
    ({ scenario, slowdownMs, count }) => {
      const target = __stress.inputLatency.prepare(scenario, slowdownMs)
      if (scenario === 'undo') __stress.inputLatency.seedUndo(count)
      return target
    },
    { scenario, slowdownMs: config.slowdownMs, count },
  )
  if (scenario === 'paste')
    await page.evaluate((text: string) => navigator.clipboard.writeText(text), pasteText)
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
    const completedPaint = {
      ...paint,
      operation: correlations?.at(-1)?.operation ?? null,
      revision: observation.revision,
    }
    completed = {
      fixture: fixture.id,
      fixtureHash: fixture.sha256,
      views,
      scenario,
      state: 'warm',
      repetition,
      latencyMs: {
        inputToApplied: events.map(
          (event: { appliedAt: number; at: number }) => event.appliedAt - event.at,
        ),
        dispatch: events.map(
          (event: { completedAt: number; dispatchAt: number }) =>
            event.completedAt - event.dispatchAt,
        ),
        inputToFrame: events.map(
          (event: { frameAt: number; at: number }) => event.frameAt - event.at,
        ),
        burstToPaintUpperBound: [paint.completedAt - events[0].at],
      },
      observation: {
        ...observation,
        ...diagnostic,
        target,
        paint: completedPaint,
        rendered,
        correlations,
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
        message: error instanceof Error ? error.message : String(error),
        observed: await page.evaluate(() => {
          const value = __stress.observe()
          return { state: value.state, scroll: value.scroll, geometry: value.geometry }
        }),
      }),
    )
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
    (repetition >= 0 && cleanup.afterListeners > cleanup.beforeListeners)
  )
    fail(`Input cleanup failed: ${JSON.stringify(cleanup)}`)
  return { ...completed, cleanup }
}

async function sendInput(page: Page, cdp: CDPSession, scenario: string, count: number) {
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

async function observePaint(
  page: Page,
  scenario: InputScenario,
  before: Buffer,
  observation: ReturnType<typeof __stress.inputLatency.finish>,
) {
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
