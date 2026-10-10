import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import type { Scenario } from './index'
import { stageRelease } from './server-update'

const NAME = 'server-restart'
// Long enough that a person looks at the screen and wonders whether anything is happening.
const SLOW_RESTART_MS = 6000
const EXPECTED_OFFLINE_NOTICE =
  /^.+ is unreachable\. (Reconnect to use this terminal\.|Showing cached data\.)$/
const EXPECTED_TERMINAL_CONNECTING_NOTICE =
  'Connecting to the terminal. You can scroll the saved output until it connects.'

type Sample = {
  readonly at: number
  readonly documentTimeOrigin: number
  readonly item: string | null
  readonly spinning: boolean
  readonly alerts: readonly string[]
}

declare global {
  interface Window {
    restartSamples?: Sample[]
    restartClickedAt?: number
  }
}

// Runs in each document; session storage keeps one timeline across both reloads.
function sampleRestartDocument() {
  if (window !== window.top) return
  const started = Number(sessionStorage.getItem('scenario-restart-started'))
  if (!started) return
  const samples: Sample[] = JSON.parse(sessionStorage.getItem('scenario-restart-samples') ?? '[]')
  window.restartSamples = samples
  const clicked = sessionStorage.getItem('scenario-restart-clicked')
  window.restartClickedAt = clicked === null ? undefined : Number(clicked)
  document.addEventListener(
    'click',
    () => {
      window.restartClickedAt ??= Date.now() - started
      sessionStorage.setItem('scenario-restart-clicked', String(window.restartClickedAt))
    },
    { capture: true },
  )
  const timer = setInterval(() => {
    const item = document.querySelector<HTMLElement>('[data-server-update]')
    const alerts = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="alert"], [data-sonner-toast], [role="status"].text-warning',
      ),
      (element) => element.innerText.trim(),
    ).filter(Boolean)
    samples.push({
      at: Date.now() - started,
      documentTimeOrigin: performance.timeOrigin,
      item: item?.dataset.serverUpdate ?? null,
      spinning: item?.querySelector('[data-slot="spinner"]') !== null && item !== null,
      alerts,
    })
    sessionStorage.setItem('scenario-restart-samples', JSON.stringify(samples))
    if (samples.length > 600) clearInterval(timer)
  }, 50)
}

/** Records the titlebar item and every alert, toast or warning on screen, every 50 ms. */
async function startSampling(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem('scenario-restart-started', String(Date.now()))
    sessionStorage.removeItem('scenario-restart-samples')
    sessionStorage.removeItem('scenario-restart-clicked')
  })
  await page.addInitScript(sampleRestartDocument)
  await page.evaluate(sampleRestartDocument)
}

async function verifyRestart(
  page: Page,
  { step, server, evidence }: Parameters<Scenario['run']>[1],
  reloadDocument: boolean,
) {
  ok(server, `${NAME} restarts the throwaway API server; drop --shared-dev`)
  await page.addInitScript(() => {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const meta = document.createElement('meta')
        meta.name = 'platform-release'
        meta.content = sessionStorage.getItem('scenario-restarted-release') ?? 'initial-release'
        document.head.append(meta)
      },
      { once: true },
    )
  })
  await page.reload()
  await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
  await stageRelease(server)
  await selectors.serverUpdateApply(page).waitFor()
  await step('update-available')

  server.restartDelayMs = reloadDocument ? 8000 : SLOW_RESTART_MS
  await startSampling(page)
  let before = await page.evaluate(() => performance.timeOrigin)
  await page.evaluate(() =>
    sessionStorage.setItem('scenario-restarted-release', '20260925T120000Z-scenario-staged'),
  )
  await selectors.serverUpdateApply(page).click()
  await page.waitForTimeout(600)
  await selectors.serverUpdating(page).waitFor()
  ok(await selectors.serverUpdating(page).isDisabled(), 'The update control is disabled')
  await step('restart-clicked')
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await selectors.phoneShell(page).waitFor()
  await selectors.serverUpdating(page).waitFor()
  ok(await selectors.serverUpdating(page).isDisabled(), 'The phone update control is disabled')
  await step('phone-reconnecting')
  if (viewport) await page.setViewportSize(viewport)
  await page.waitForTimeout(1500)
  await step('server-down')
  if (reloadDocument) {
    await page.reload()
    before = await page.evaluate(() => performance.timeOrigin)
    await selectors.serverUpdating(page).waitFor({ timeout: 5000 })
    await step('document-reloaded-mid-update')
  }
  await page.waitForFunction((started) => performance.timeOrigin !== started, before, {
    timeout: 20_000,
  })
  await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
  await selectors.serverUpdate(page).waitFor({ state: 'detached', timeout: 20_000 })
  await page.waitForTimeout(1500)
  await step('restarted')

  const { samples, clickedAt } = await page.evaluate(() => ({
    samples: (window.restartSamples ??
      JSON.parse(sessionStorage.getItem('scenario-restart-samples') ?? '[]')) as Sample[],
    clickedAt:
      window.restartClickedAt ?? Number(sessionStorage.getItem('scenario-restart-clicked') ?? 0),
  }))
  const timelinePath = await evidence.json('restart-samples.json', { clickedAt, samples })
  console.log(`sample timeline: ${timelinePath}`)
  const shown = samples.filter((sample) => sample.item === 'restarting' && sample.at > clickedAt)
  const alerts = [...new Set(samples.flatMap((sample) => sample.alerts))]
  const documentCount = new Set(samples.map((sample) => sample.documentTimeOrigin)).size
  console.log(`sampled documents: ${documentCount}; samples: ${samples.length}`)
  ok(documentCount >= (reloadDocument ? 3 : 2), 'Every document is sampled across the restart')
  console.log(`item states: ${[...new Set(samples.map((sample) => sample.item))].join(' → ')}`)
  console.log(`alerts: ${alerts.length ? alerts.join(' | ') : 'none'}`)
  ok(shown.length > 0, 'The update is observed while reconnecting')
  ok(
    shown.every((sample) => sample.spinning),
    'Every in-progress update shows the shared Spinner',
  )
  const unexpectedAlerts = [
    ...new Set(
      samples.flatMap((sample) =>
        sample.alerts.filter(
          (alert) =>
            alert !== EXPECTED_TERMINAL_CONNECTING_NOTICE &&
            (sample.item !== 'restarting' || !EXPECTED_OFFLINE_NOTICE.test(alert)),
        ),
      ),
    ),
  ]
  const expectedNotices = alerts.filter((alert) => EXPECTED_OFFLINE_NOTICE.test(alert))
  console.log(`expected offline notices recorded: ${expectedNotices.join(' | ') || 'none'}`)
  console.log(
    `transient terminal connecting statuses recorded: ${alerts.filter((alert) => alert === EXPECTED_TERMINAL_CONNECTING_NOTICE).length}`,
  )
  console.log(`final document alerts: ${samples.at(-1)?.alerts.join(' | ') || 'none'}`)
  ok(samples.at(-1)?.alerts.length === 0, 'The healthy document clears every offline notice')
  ok(
    unexpectedAlerts.length === 0,
    `an expected restart shows no unexpected alert: ${unexpectedAlerts.join(' | ')}`,
  )
}

export const serverRestart: Scenario = {
  name: NAME,
  description:
    'Update a staged release on a server that takes 6 s to come back. The control shows a Spinner beside its current step and no expected disconnect becomes an error.',
  run: (page, context) => verifyRestart(page, context, false),
}

export const serverRestartRecovery: Scenario = {
  name: 'server-restart-recovery',
  description:
    'Reload the initiating document while its server restarts, restore the exact update target, and reload automatically after that release becomes healthy.',
  run: (page, context) => verifyRestart(page, context, true),
}
