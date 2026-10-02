import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { selectors } from '../selectors'
import type { Scenario } from './index'
import { stageRelease } from './server-update'

const NAME = 'server-restart'
// Long enough that a person looks at the screen and wonders whether anything is happening.
const SLOW_RESTART_MS = 3000

type Sample = {
  readonly at: number
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

/** Records the titlebar item and every alert, toast or warning on screen, every 50 ms. */
async function startSampling(page: Page) {
  await page.evaluate(() => {
    const samples: Sample[] = []
    window.restartSamples = samples
    sessionStorage.removeItem('scenario-restart-samples')
    const started = performance.now()
    document.addEventListener(
      'click',
      () => {
        window.restartClickedAt ??= Math.round(performance.now() - started)
        sessionStorage.setItem('scenario-restart-clicked', String(window.restartClickedAt))
      },
      { capture: true },
    )
    const timer = setInterval(() => {
      const item = document.querySelector<HTMLElement>('[data-server-update]')
      const alerts = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="alert"], [data-sonner-toast], [role="status"].text-warning',
        ),
      ]
        .map((element) => element.innerText.trim())
        .filter(Boolean)
      samples.push({
        at: Math.round(performance.now() - started),
        item: item?.dataset.serverUpdate ?? null,
        spinning: item?.querySelector('[data-restart-spinning]') !== null && item !== null,
        alerts,
      })
      sessionStorage.setItem('scenario-restart-samples', JSON.stringify(samples))
      if (samples.length > 600) clearInterval(timer)
    }, 50)
  })
}

export const serverRestart: Scenario = {
  name: NAME,
  description:
    'Update a staged release on a server that takes 3 s to come back. The control says Updating… without an icon and no expected disconnect becomes an error.',
  async run(page, { step, server }) {
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

    server.restartDelayMs = SLOW_RESTART_MS
    await startSampling(page)
    const before = await page.evaluate(() => performance.timeOrigin)
    await page.evaluate(() =>
      sessionStorage.setItem('scenario-restarted-release', '20260925T120000Z-scenario-staged'),
    )
    await selectors.serverUpdateApply(page).click()
    await page.waitForTimeout(600)
    await step('restart-clicked')
    await page.waitForTimeout(1500)
    await step('server-down')
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
    const shown = samples.filter((sample) => sample.item !== null && sample.at > clickedAt)
    const alerts = [...new Set(samples.flatMap((sample) => sample.alerts))]
    console.log(`item states: ${[...new Set(samples.map((sample) => sample.item))].join(' → ')}`)
    console.log(`alerts: ${alerts.length ? alerts.join(' | ') : 'none'}`)
    ok(shown.length > 0, 'The update is observed while reconnecting')
    ok(
      shown.every((sample) => !sample.spinning),
      'Updating keeps the control still',
    )
    ok(alerts.length === 0, `an expected restart shows no alert: ${alerts.join(' | ')}`)
  },
}
