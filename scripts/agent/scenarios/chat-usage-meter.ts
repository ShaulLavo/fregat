import type { Page } from 'playwright'
import { strictEqual } from 'node:assert/strict'
import { selectors, settleAnimations } from '../selectors'
import type { Scenario } from './index'

const usageRoute = /\/providers\/usage(\?|$)/
const HOUR_MS = 3_600_000

/**
 * Serves fixed plan windows so the warning and spent states are reachable without
 * spending a real allowance. The default instances share neither account, so each
 * gets its own entry, and whichever the new session picks carries a warning. The
 * Codex reading is twenty minutes old, so its popover says it may be out of date.
 */
function usageFixture(nowMs: number) {
  const resetsIn = (hours: number) => new Date(nowMs + hours * HOUR_MS).toISOString()

  return {
    accounts: [
      {
        accountKey: 'fixture-claude',
        driverKind: 'claude',
        planType: null,
        providerInstanceIds: ['claude'],
        checkedAt: new Date(nowMs - 20 * 60_000).toISOString(),
        windows: [
          window('five_hour', 'session', 'Session', 42, resetsIn(3.4), 'allowed'),
          window('seven_day', 'weekly', 'Weekly', 83, resetsIn(5 * 24 + 5), 'warning'),
          window('seven_day_opus', 'weekly', 'Weekly · Opus', 100, resetsIn(-1), 'rejected'),
        ],
      },
      {
        accountKey: 'fixture-codex',
        driverKind: 'codex',
        planType: 'pro',
        providerInstanceIds: ['codex'],
        checkedAt: new Date(nowMs - 20 * 60_000).toISOString(),
        windows: [
          window('primary', 'session', 'Session', 100, resetsIn(1.2), 'rejected'),
          window('secondary', 'weekly', 'Weekly', 64, resetsIn(72), null),
          window('expired', 'monthly', 'Monthly', 100, resetsIn(-1), 'rejected'),
        ],
      },
    ],
  }
}

function window(
  id: string,
  kind: string,
  label: string,
  usedPercent: number,
  resetsAt: string,
  status: string | null,
) {
  const windowMinutes = { monthly: 43_200, session: 300, weekly: 10_080 }[kind] ?? null

  return { id, kind, label, resetsAt, status, usedPercent, windowMinutes }
}

/** Serves the fixed windows and reloads so the page reads them; call the result to stop. */
export async function reloadWithUsageFixture(page: Page) {
  await page.route(usageRoute, (route) =>
    route.fulfill({ contentType: 'application/json', json: usageFixture(Date.now()) }),
  )
  await page.reload()
  await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })

  return () => page.unroute(usageRoute)
}

export const chatUsageMeter: Scenario = {
  name: 'chat-usage-meter',
  description:
    'Composer plan-usage meter: the real /providers/usage read answers, then fixed windows drive trigger tone, tooltip and popover.',
  async run(page, { step }) {
    // The real read first: the route must answer before any fixture stands in for it.
    const realRead = page.waitForResponse(usageRoute, { timeout: 45_000 })
    await page.reload()
    await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatNewSession(page).click()
    const response = await realRead
    strictEqual(response.status(), 200, 'GET /providers/usage')
    strictEqual(Array.isArray((await response.json()).accounts), true, 'usage accounts array')
    // The real account, whatever it holds: evidence, not an assertion.
    await page.mouse.move(0, 0)
    await step('real-read')

    const unroute = await reloadWithUsageFixture(page)
    try {
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.chatNewSession(page).click()

      const meter = selectors.usageMeter(page)
      await meter.waitFor({ timeout: 20_000 })
      const tone = await meter.getAttribute('data-tone')
      strictEqual(tone === 'warning' || tone === 'destructive', true, `meter tone ${tone}`)
      await page.mouse.move(0, 0)
      await step('meter')

      await meter.hover()
      const tooltip = selectors.tooltipPopup(page)
      await tooltip.waitFor({ timeout: 5_000 })
      await settleAnimations(tooltip)
      await step('meter-hover')

      await meter.click()
      const popover = selectors.usagePopover(page)
      await popover.waitFor({ timeout: 10_000 })
      await settleAnimations(popover)
      // Each account also carries a window whose reset has passed; it must not show.
      strictEqual(await selectors.usageWindowRows(page).count(), 2, 'one row per live window')
      // The weekly window is part-used with time left, so it carries a pace marker.
      strictEqual(await selectors.usagePaceMarkers(page).count(), 1, 'pace on the unspent window')
      const checked = (await selectors.usageChecked(page).textContent()) ?? ''
      strictEqual(checked.startsWith('Checked '), true, `checked label ${checked}`)
      await step('popover')

      // The popover's way out: Settings › Usage, where the history lives.
      await selectors.usageMeterViewUsage(page).click()
      await selectors.usageSection(page).waitFor({ timeout: 20_000 })
      await popover.waitFor({ state: 'hidden', timeout: 5_000 })
      await step('view-usage')
    } finally {
      await unroute()
    }
  },
}
