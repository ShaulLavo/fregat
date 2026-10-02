import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const verifyClientUpdate: Scenario['run'] = async (page, { step, server }) => {
  ok(server, 'This scenario uses the isolated server release files')
  const config = join(server.directory, 'served', 'build-config.json')
  await writeFile(config, JSON.stringify({ release: 'client-1' }))
  await page.evaluate(() => sessionStorage.removeItem('scenario-client-release'))
  // Vite serves the document; attach the identity that deployment stamps into built HTML.
  await page.addInitScript(() => {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const meta = document.createElement('meta')
        meta.name = 'platform-release'
        meta.content = sessionStorage.getItem('scenario-client-release') ?? 'client-1'
        document.head.append(meta)
      },
      { once: true },
    )
  })
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/release')),
    page.reload(),
  ])
  await page.waitForTimeout(500)
  ok(
    (await selectors.clientUpdateRefresh(page).count()) === 0,
    'Matching client stays quiet even though the server release differs',
  )
  await step('current-client')

  const started = await page.evaluate(() => performance.timeOrigin)
  await writeFile(config, JSON.stringify({ release: 'client-2' }))
  // The visibility event exercises Query's normal return-to-tab refetch.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
  )
  await selectors.clientUpdateRefresh(page).waitFor({ timeout: 15_000 })
  ok(
    (await page.evaluate(() => performance.timeOrigin)) === started,
    'An update never reloads automatically',
  )
  await step('refresh-available')

  await selectors.toastDismiss(page, 'Update available').click()
  await selectors.clientUpdateRefresh(page).waitFor({ state: 'hidden' })
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
  )
  await page.waitForTimeout(500)
  ok(
    (await selectors.clientUpdateRefresh(page).count()) === 0,
    'Dismissal survives a release refetch',
  )
  ok(
    (await page.evaluate(() => performance.timeOrigin)) === started,
    'Dismissal leaves the app running',
  )
  await step('dismissed-without-reload')

  await page.reload()
  await selectors.clientUpdateRefresh(page).waitFor({ timeout: 15_000 })

  await page.evaluate(() => sessionStorage.setItem('scenario-client-release', 'client-2'))
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/release')),
    selectors.clientUpdateRefresh(page).click(),
  ])
  await page.waitForTimeout(500)
  ok(
    (await page.evaluate(() => performance.timeOrigin)) !== started,
    'Refresh reloads the document',
  )
  ok(
    (await selectors.clientUpdateRefresh(page).count()) === 0,
    'The refreshed client clears the prompt',
  )
  await step('refreshed')
}
