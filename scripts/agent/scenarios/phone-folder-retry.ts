import { strictEqual } from 'node:assert/strict'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import { openFixtureChat } from './phone-fixture'
import type { Scenario } from './index'

export const phoneFolderRetry: Scenario = {
  name: 'phone-folder-retry',
  description:
    'Retry a folder during cached phone startup, then recover failed health through its connection owner.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('phone-folder-startup')
    const gate = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    let failHealth = false
    let socketCount = 0
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'startup fixture'])
      const base = await openFixtureChat(page, fixture)
      await selectors.chatNewSession(page).click()
      await selectors.modelPickerTrigger(page).waitFor()
      await selectors.chatPhoneFolder(page, fixture.split('/').at(-1)!).waitFor()
      await step('healthy-phone-folder')
      const healthUrl = `${base.replace(/\/orchestration$/, '')}/health`
      const descriptor = await (
        await page.request.get(healthUrl, {
          headers: { Origin: new URL(page.url()).origin },
        })
      ).json()
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname.endsWith('/orchestration/rpc')) socketCount += 1
      })
      await page.route(healthUrl, async (route) => {
        requested.resolve()
        await gate.promise
        if (failHealth)
          await route.fulfill({ status: 503, json: { message: 'Fixture health unavailable' } })
        else await route.continue()
      })
      await page.goto(page.url().replace(/\/chat(?:\/t\/[^?]+)?(?:\?.*)?$/, '/chat'))
      await requested.promise
      await step('cached-health-pending-observed-screen')
      await evidence.json('pending-route.json', { url: page.url() })
      await selectors.chatFolderRetry(page).waitFor()
      strictEqual(socketCount, 0)
      await step('cached-phone-awaits-health')
      await selectors.chatFolderRetry(page).click()
      await selectors.chatFolderRetry(page).waitFor()
      await step('retry-while-health-pending')
      strictEqual(
        await selectors.chatClosedConnection(page).count(),
        0,
        'Folder retry must not dispatch through the closed cached startup client',
      )
      gate.resolve()
      await selectors.modelPickerTrigger(page).waitFor({ timeout: 20_000 })
      await selectors.chatPhoneFolder(page, fixture.split('/').at(-1)!).waitFor()
      await step('fresh-health-prepares-selected-folder')
      failHealth = true
      const failedHealth = page.waitForResponse(
        (response) => response.url() === healthUrl && response.status() === 503,
      )
      await page.reload()
      await failedHealth
      await selectors.phoneBack(page).click()
      const notice = selectors.machineConnectionNotice(page, descriptor.label, 'Disconnected')
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Retry', exact: true }).waitFor()
      await step('failed-health-keeps-recovery-control')
      failHealth = false
      await notice.getByRole('button', { name: 'Retry', exact: true }).click()
      await notice.waitFor({ state: 'hidden' })
      await selectors.chatNewSession(page).click()
      await selectors.modelPickerTrigger(page).waitFor({ timeout: 20_000 })
      await selectors.chatPhoneFolder(page, fixture.split('/').at(-1)!).waitFor()
      const snapshot = await readShell(page, base)
      strictEqual(
        snapshot.worktrees.filter((worktree) => worktree.path === fixture.slice(1)).length,
        1,
      )
      strictEqual(await selectors.chatClosedConnection(page).count(), 0)
      await step('owner-retry-recovers-selected-folder')
      await evidence.json('folder-result.json', { fixture, socketCount, registered: true })
    } finally {
      gate.resolve()
      await page.unrouteAll({ behavior: 'wait' })
      await page.goto('about:blank')
      await releaseFixture(fixture)
      await evidence.json('folder-cleanup.json', { fixtureReleased: true })
    }
  },
}
