import { ok } from 'node:assert/strict'
import type { Page, Response } from 'playwright'
import { BUNDLED_THEMES } from '../../../packages/contracts/src/index'
import { writeUserOperations } from '../preserve-settings'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

// Two backoff periods at the stream's 5 s cap: long enough to see a loop repeat.
const OBSERVE_MS = 14_000

/** Every GET /settings the page made, with its status. */
function recordSettingsReads(page: Page) {
  const reads: number[] = []
  const onResponse = (response: Response) => {
    const url = new URL(response.url())
    if (url.pathname.endsWith('/settings') && response.request().method() === 'GET') {
      reads.push(response.status())
    }
  }
  page.on('response', onResponse)
  return {
    reads,
    stop: () => page.off('response', onResponse),
  }
}

const SETTINGS_READ = /\/settings(?:\?.*)?$/

/** Answers every GET /settings as a newer server would: one diagnostic kind this build lacks. */
async function answerAsNewerServer(page: Page) {
  const origin = new URL(page.url()).origin
  await page.route(SETTINGS_READ, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch({ headers: { ...route.request().headers(), origin } })
    const snapshot = (await response.json()) as { diagnostics: unknown[] }
    const diagnostic = { kind: 'from-a-newer-server', id: 'editor.fontSize', layer: 'user' }
    await route.fulfill({
      response,
      json: { ...snapshot, diagnostics: [...snapshot.diagnostics, diagnostic] },
    })
  })
}

export const settingsStreamGiveUp: Scenario = {
  name: 'settings-stream-give-up',
  description:
    'The server starts sending settings this tab cannot read: the stream stops at once, a toast says settings stopped syncing, and Reload brings the page back.',
  async run(page, { step }) {
    const recorder = recordSettingsReads(page)
    await answerAsNewerServer(page)
    try {
      // Suspending and restoring the page reconnects the stream, which refetches the document.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'))
        window.dispatchEvent(new Event('pageshow'))
      })
      const toast = selectors.toast(page, 'Settings stopped syncing')
      await toast.waitFor({ timeout: 10_000 })
      await step('stopped-toast')
      await page.waitForTimeout(OBSERVE_MS)
      ok(recorder.reads.length === 1, `The stream read /settings ${recorder.reads.length} times`)
      await step('still-stopped')
      await page.unroute(SETTINGS_READ)
      await selectors.toastAction(page, 'Settings stopped syncing', 'Reload').click()
      await waitForApp(page)
      await toast.waitFor({ state: 'detached' })
      await step('reloaded')
    } finally {
      recorder.stop()
      await page.unroute(SETTINGS_READ)
    }
  },
}

export const settingsNewerServer: Scenario = {
  name: 'settings-newer-server',
  description:
    'A user file that sets a theme part under a theme makes the server send `set-by-theme` diagnostics; the page reads them and its settings stream stays connected.',
  async run(page, { step }) {
    const sage = BUNDLED_THEMES.find((theme) => theme.id === 'sage')
    ok(sage, 'Bundled Sage theme exists')
    // Palette first: with a theme selected, a palette write lands in the theme's customizations.
    await writeUserOperations(page, [{ kind: 'set', key: 'workbench.palette', value: 'sage' }])
    await writeUserOperations(page, [{ kind: 'set', key: 'workbench.theme', value: sage }])
    const recorder = recordSettingsReads(page)
    try {
      await page.reload()
      await waitForApp(page)
      await page.waitForTimeout(OBSERVE_MS)
      await step('observed')
    } finally {
      recorder.stop()
    }
    console.log(`settings reads: ${recorder.reads.join(',')}`)
    ok(
      recorder.reads.length <= 3,
      `The page read /settings ${recorder.reads.length} times in ${OBSERVE_MS} ms; its stream is looping`,
    )
  },
}
