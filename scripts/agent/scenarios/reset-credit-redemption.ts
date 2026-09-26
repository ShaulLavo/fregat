import { deepStrictEqual, equal } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

/**
 * A Codex account at its limit with one reset credit: Cancel spends nothing, Confirm spends it once
 * with a durable key, and the meter reads the refreshed limits. Fixture account; no real credit.
 */
export const resetCreditRedemption = isolatedNativeScenario({
  name: 'reset-credit-redemption',
  description:
    'A fixture Codex account at its session limit offers its reset credit in the usage meter; Cancel spends nothing, Confirm consumes it once and the meter reads the reset limits.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root }) {
    const consumed = async () =>
      (await nativeLog(root)).filter((entry) => entry.event === 'reset-consume')
    const meter = selectors.usageMeter(page)
    await meter.waitFor({ timeout: 30_000 })
    await meter.click()
    const popover = selectors.usagePopover(page)
    const action = popover.getByRole('button', { name: 'Use reset credit…', exact: true })
    await action.waitFor({ timeout: 30_000 })
    await step('credit-offered')

    await action.click()
    const dialog = page.getByRole('dialog', { name: 'Use one reset credit?' })
    await dialog.waitFor()
    await step('confirm-dialog')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    equal((await consumed()).length, 0, 'Cancel spends nothing')

    if (!(await popover.isVisible())) await meter.click()
    await action.click()
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.getByText('Usage limits reset.', { exact: true }).waitFor({ timeout: 30_000 })
    const [consume, ...more] = await consumed()
    equal(more.length, 0, 'One redemption')
    const params = consume?.params as { creditId: string; idempotencyKey: string } | undefined
    deepStrictEqual(params?.creditId, 'credit-verify')
    equal(typeof params?.idempotencyKey, 'string')
    await step('credit-spent-once')
  },
})
