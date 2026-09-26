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
    const started = performance.now()
    document.addEventListener(
      'click',
      () => {
        window.restartClickedAt ??= Math.round(performance.now() - started)
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
      if (samples.length > 600) clearInterval(timer)
    }, 50)
  })
}

export const serverRestart: Scenario = {
  name: NAME,
  description:
    'Restart a staged release for real on a server that takes 3 s to come back: the Restart icon spins from the click until the new server answers, and nothing on screen turns into an error.',
  async run(page, { step, server }) {
    ok(server, `${NAME} restarts the throwaway API server; drop --shared-dev`)
    await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
    await stageRelease(server)
    await selectors.serverUpdateRestart(page).waitFor()
    await step('update-available')

    server.restartDelayMs = SLOW_RESTART_MS
    await startSampling(page)
    await selectors.serverUpdateRestart(page).click()
    await page.waitForTimeout(600)
    await step('restart-clicked')
    await page.waitForTimeout(1500)
    await step('server-down')
    await selectors.serverUpdate(page).waitFor({ state: 'detached', timeout: 20_000 })
    await page.waitForTimeout(1500)
    await step('restarted')

    const { samples, clickedAt } = await page.evaluate(() => ({
      samples: window.restartSamples ?? [],
      clickedAt: window.restartClickedAt ?? 0,
    }))
    const shown = samples.filter((sample) => sample.item !== null && sample.at > clickedAt)
    const alerts = [...new Set(samples.flatMap((sample) => sample.alerts))]
    console.log(`item states: ${[...new Set(samples.map((sample) => sample.item))].join(' → ')}`)
    console.log(`alerts: ${alerts.length ? alerts.join(' | ') : 'none'}`)
    const idle = shown.filter((sample) => !sample.spinning)
    ok(
      idle.length === 0,
      `the Restart icon spins from the click until the item leaves; idle at ${idle.map((sample) => sample.at).join(', ')} ms`,
    )
    ok(alerts.length === 0, `an expected restart shows no alert: ${alerts.join(' | ')}`)
  },
}
