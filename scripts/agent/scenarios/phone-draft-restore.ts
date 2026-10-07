import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import { openFixtureChat } from './phone-fixture'
import type { Scenario } from './index'

async function allowHealthOnRetry(page: Page, allow: () => void) {
  await page.exposeFunction('allowDraftRestoreHealth', allow)
  await selectors.bootstrapRetry(page).evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        const recover = Reflect.get(window, 'allowDraftRestoreHealth')
        if (typeof recover === 'function') void recover()
      },
      { once: true, capture: true },
    )
  })
}

export const phoneDraftRestore: Scenario = {
  name: 'phone-draft-restore',
  description: 'Reconnect a concrete phone draft after its first fresh health request fails.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step, evidence }) {
    const fixture = await createGitFixture('phone-draft-restore')
    const gate = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    let failHealth = false
    let socketCount = 0
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'draft restore fixture'])
      const base = await openFixtureChat(page, fixture)
      await selectors.chatNewSession(page).click()
      await selectors.modelPickerTrigger(page).waitFor()
      const folder = selectors.chatPhoneFolder(page, fixture.split('/').at(-1)!)
      await folder.waitFor()
      const address = page.url()
      ok(address.includes('/chat/t/draft-'), 'New session names a concrete draft')
      await step('healthy-concrete-draft')
      await page.reload()
      await selectors.modelPickerTrigger(page).waitFor()
      await folder.waitFor()
      strictEqual(page.url(), address)
      await step('healthy-concrete-draft-reload')
      const healthUrl = `${base.replace(/\/orchestration$/, '')}/health`
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname.endsWith('/orchestration/rpc')) socketCount += 1
      })
      await page.route(healthUrl, async (route) => {
        requested.resolve()
        await gate.promise
        if (!failHealth) {
          await route.continue()
          return
        }
        await route.fulfill({ status: 503, json: { message: 'Fixture health unavailable' } })
      })
      await page.reload()
      await requested.promise
      await folder.waitFor()
      strictEqual(socketCount, 0, 'Pending first health has no admitted socket')
      await step('cached-draft-with-pending-health')
      const connected = page.waitForEvent('websocket', {
        predicate: (socket) => new URL(socket.url()).pathname.endsWith('/orchestration/rpc'),
      })
      gate.resolve()
      await connected
      await selectors.modelPickerTrigger(page).waitFor()
      await folder.waitFor()
      await step('released-health-restores-draft')
      failHealth = true
      socketCount = 0
      const failed = page.waitForResponse(
        (response) => response.url() === healthUrl && response.status() === 503,
      )
      await page.reload()
      await failed
      await step('failed-first-health-observed')
      await selectors.bootstrapRetry(page).waitFor()
      strictEqual(socketCount, 0, 'Failed first health has no admitted socket')
      strictEqual(page.url(), address)
      await step('failed-first-health-exposes-owner-retry')
      await allowHealthOnRetry(page, () => {
        failHealth = false
      })
      const reconnected = page.waitForEvent('websocket', {
        predicate: (socket) => new URL(socket.url()).pathname.endsWith('/orchestration/rpc'),
      })
      await selectors.bootstrapRetry(page).click()
      await reconnected
      await selectors.modelPickerTrigger(page).waitFor()
      await folder.waitFor()
      await selectors.bootstrapRetry(page).waitFor({ state: 'hidden' })
      strictEqual(page.url(), address)
      strictEqual(socketCount, 1, 'Owner Retry creates one fresh socket')
      const snapshot = await readShell(page, base)
      strictEqual(
        snapshot.worktrees.filter((worktree) => worktree.path === fixture.slice(1)).length,
        1,
      )
      await step('owner-retry-restores-same-draft')
      await evidence.json('draft-restore-result.json', {
        address,
        socketCount,
        uniqueWorktree: true,
      })
    } finally {
      gate.resolve()
      await page.unrouteAll({ behavior: 'wait' })
      await page.goto('about:blank')
      await releaseFixture(fixture)
      await evidence.json('draft-restore-cleanup.json', { fixtureReleased: true })
    }
  },
}
