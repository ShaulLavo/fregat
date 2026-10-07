import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { readLogs } from '../logs'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const ingestRoute = /\/_log\/ingest(?:\?|$)/
const writeRoute = /\/settings\/write$/

export const clientLogDelivery: Scenario = {
  name: 'client-log-delivery',
  description:
    'A failed settings save retains its error log through a reload and delivers it after reconnection.',
  requiresIsolatedServer: true,
  async run(page, { step, server, evidence }) {
    ok(server, 'The delivery scenario needs an isolated server.')
    await page.route(ingestRoute, (route) => route.abort('internetdisconnected'))
    await page.route(writeRoute, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'settings.UNKNOWN_KEY',
            message: 'This setting could not be saved.',
            why: 'The server rejected this setting.',
            fix: 'Undo the change and try again.',
          },
        }),
      }),
    )
    try {
      await selectors.settingsOpen(page).click()
      await selectors.settingsSearch(page).fill('seams')
      await selectors.settingsContinuousSeams(page).click()
      await selectors.toast(page, 'Could not save settings').waitFor()
      await page.waitForFunction(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith('platform.client-log.v1:') &&
            localStorage.getItem(key)?.includes('settings.UNKNOWN_KEY'),
        ),
      )
      const beforeReload = await retained(page)
      await evidence.json('retained-before-reload.json', beforeReload)
      await step('failure-retained-while-offline')
      await page.unroute(writeRoute)
      await page.reload()
      await waitForApp(page)
      const afterReload = await retained(page)
      ok(
        beforeReload.some((entry) =>
          afterReload.some((other) => other.event.eventId === entry.event.eventId),
        ),
        'The reload lost every retained failure.',
      )
      await evidence.json('retained-after-reload.json', afterReload)
      await step('failure-survives-reload')
      await page.unroute(ingestRoute)
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await page.waitForFunction(
        () => Object.keys(localStorage).every((key) => !key.startsWith('platform.client-log.v1:')),
        undefined,
        { timeout: 30_000 },
      )
      const failures = beforeReload.filter((entry) =>
        JSON.stringify(entry.event).includes('settings.UNKNOWN_KEY'),
      )
      ok(failures.length > 0, 'The rejected settings save produced no retained failure.')
      const logs = await recoveredLogs(
        page,
        server.logs,
        evidence.startedAt,
        failures.map((failure) => failure.event.eventId),
      )
      for (const failure of failures) {
        const matches = logs.filter((event) => event.eventId === failure.event.eventId)
        ok(matches.length === 1, 'A recovered failure must arrive once in server logs.')
      }
      await evidence.json(
        'recovered-server-events.json',
        logs.filter((event) => beforeReload.some((entry) => entry.event.eventId === event.eventId)),
      )
      await step('server-acknowledged-recovered-errors')
    } finally {
      await page.unroute(ingestRoute)
      await page.unroute(writeRoute)
    }
  },
}

async function recoveredLogs(page: Page, directory: string, since: Date, ids: readonly string[]) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const logs = await readLogs({ directory, since })
    if (ids.every((id) => logs.some((event) => event.eventId === id))) return logs
    await page.waitForTimeout(250)
  }
  return readLogs({ directory, since })
}

function retained(
  page: Page,
): Promise<{ instanceId: string; event: { eventId: string; [key: string]: unknown } }[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('platform.client-log.v1:'))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? 'null')),
  )
}
