import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { openChat } from './chat-verification'
import type { Scenario } from './index'

// The identity a production database carried before it was reset.
const REPLACED_ID = '13c7d86d-fa6c-4548-a7da-ff69e46b40eb'

/** Rewrites this profile as if the server's database had carried `REPLACED_ID`. */
function ageProfile(page: Page, replacedId: string) {
  return page.evaluate((replacedId) => {
    const binding = Object.keys(localStorage).find((key) =>
      key.endsWith('|platform.environments.binding.v1'),
    )
    if (!binding) return null
    const current = binding.slice('env:'.length, binding.indexOf('|'))
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`env:${current}|`)) continue
      const value = localStorage.getItem(key)!.replaceAll(current, replacedId)
      localStorage.setItem(key.replace(current, replacedId), value)
      localStorage.removeItem(key)
    }
    return current
  }, replacedId)
}

function storedIdentities(page: Page) {
  return page.evaluate(() => [
    ...new Set(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('env:'))
        .map((key) => key.slice('env:'.length, key.indexOf('|'))),
    ),
  ])
}

export const primaryIdentityReplacement: Scenario = {
  name: 'primary-identity-replacement',
  description:
    'Reload a profile that remembers an earlier database identity for the page’s own server. The tab forgets the old identity, reloads once by itself, and lands on the live workbench.',
  async run(page, { step }) {
    await openChat(page)
    await selectors.windowToolbar(page).waitFor()
    const current = await ageProfile(page, REPLACED_ID)
    ok(current, 'The warm profile holds a primary binding')
    await step('Profile remembers the replaced database identity')
    const loads: string[] = []
    page.on('load', () => loads.push(page.url()))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      (replacedId) =>
        !Object.keys(localStorage).some((key) => key.startsWith(`env:${replacedId}|`)),
      REPLACED_ID,
    )
    await selectors.windowToolbar(page).waitFor({ timeout: 30_000 })
    await page.waitForFunction(
      (current) =>
        Object.keys(localStorage).includes(`env:${current}|platform.environments.binding.v1`),
      current,
    )
    strictEqual(await selectors.connectionRefused(page).count(), 0, 'No connection gate')
    strictEqual(await selectors.bootstrapFailure(page).count(), 0, 'No boot failure')
    ok(
      loads.length >= 2,
      `The tab reloads by itself once it meets the new identity (${loads.length})`,
    )
    const identities = await storedIdentities(page)
    ok(!identities.includes(REPLACED_ID), 'Nothing is kept for the replaced identity')
    await step('Tab adopted the new identity and reconnected')
  },
}
