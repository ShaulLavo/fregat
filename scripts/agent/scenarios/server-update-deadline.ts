import { deepEqual, ok } from 'node:assert/strict'
import type { ServerRestartInput } from '../../../packages/contracts/src/index'
import { fixtureApiBase } from '../fixture-workspace'
import { selectors } from '../selectors'
import type { Scenario } from './index'
import { stageRelease } from './server-update'

export const serverUpdateDeadline: Scenario = {
  name: 'server-update-deadline',
  requiresIsolatedServer: true,
  description:
    'An accepted restart that never becomes ready stops at its deadline, explains the failure, and retries verification of the exact release without replaying interruption consent.',
  async run(page, { step, server }) {
    ok(server, 'Update deadline verification uses the throwaway server')
    const response = await page.request.post(`${fixtureApiBase(page)}/settings/write`, {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        mutationId: crypto.randomUUID(),
        target: 'user',
        operations: [{ kind: 'set', key: 'server.activationTimeoutSeconds', value: 1 }],
      },
    })
    ok(response.ok(), 'The throwaway server uses a short activation budget')
    await page.reload()
    await selectors.projectMenuTrigger(page).waitFor()
    await stageRelease(server)
    await selectors.serverUpdateApply(page).waitFor()
    const before = await page.evaluate(() => performance.timeOrigin)
    const route = /\/server\/restart$/
    let requests = 0
    const inputs: ServerRestartInput[] = []
    // Hold only the accepted-response proof here; server-restart verifies the real process exit.
    await page.route(route, (request) => {
      requests++
      inputs.push(request.request().postDataJSON())
      return request.fulfill({ contentType: 'application/json', json: { restarting: true } })
    })
    try {
      await selectors.serverUpdateApply(page).click()
      await selectors.serverUpdating(page).waitFor()
      await step('waiting-for-release')
      await selectors.serverUpdateRetry(page).waitFor({ timeout: 5000 })
      await page.mouse.move(0, 0)
      await selectors.serverUpdateRetry(page).hover()
      await selectors.serverUpdateTooltip(page).waitFor()
      ok(
        (await selectors.serverUpdateTooltip(page).innerText()).includes('update time limit'),
        'The recovery control explains why the operation stopped',
      )
      await step('deadline-recovery')
      const retryResponse = page.waitForResponse((answer) =>
        answer.url().endsWith('/server/restart'),
      )
      await selectors.serverUpdateRetry(page).click()
      await retryResponse
      await selectors.serverUpdating(page).waitFor()
      ok(requests === 2, 'Retry resends the same staged target without interruption consent')
      deepEqual(inputs[1]?.target, inputs[0]?.target)
      deepEqual(inputs[1]?.interrupt, [])
      ok(
        (await page.evaluate(() => performance.timeOrigin)) === before,
        'Expiry and retry keep the page on its current document',
      )
      await step('retry-checks-same-release')
    } finally {
      await page.unroute(route)
    }
  },
}
