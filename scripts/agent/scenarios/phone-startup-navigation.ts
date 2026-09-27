import { equal, ok } from 'node:assert/strict'
import type { Page } from 'playwright'

import { createModifiedFileFixture, releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { createSessions, openFixtureChat, PHONE_SESSIONS } from './phone-fixture'
import type { Scenario } from './index'

let report: unknown = null

export const phoneStartupNavigation: Scenario = {
  name: 'phone-startup-navigation',
  description:
    'Cold phone list, first session press, direct session reload and cached bare-root boot at phone network and CPU speed.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step, evidence }) {
    page.setDefaultTimeout(30_000)
    const fixture = await createModifiedFileFixture('phone-startup', 'notes.md', ['one'], ['two'])
    try {
      const base = await openFixtureChat(page, fixture)
      await createSessions(page, base, fixture)
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 1_125_000,
        uploadThroughput: 187_500,
      })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await page.reload({ waitUntil: 'commit' })
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      const list = await startupSnapshot(page)
      await step('cold-list')
      // An idle callback must not immediately download the conversation after the list paints.
      await page.waitForTimeout(1_000)
      await expectConversationUnloaded(page)
      const pressedAt = await page.evaluate(() => performance.now())
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
      await selectors.chatMessage(page).waitFor()
      const firstSession = await startupSnapshot(page)
      ok(
        (await conversationResources(page)).length > 0,
        'Conversation code must be observable after the first press',
      )
      await step('first-session')
      await page.reload({ waitUntil: 'commit' })
      await selectors.chatMessage(page).waitFor()
      const directSession = await startupSnapshot(page)
      ok(
        (await conversationResources(page)).length > 0,
        'Direct session must load its conversation code',
      )
      await step('direct-session-reload')
      report = { list, firstSession, firstPressMs: firstSession.readyMs - pressedAt, directSession }
      await evidence.json('initial-navigation.json', report)
      const sessionHref = page.url()
      await selectors.phoneHeaderAction(page, 'Changes').click()
      await selectors.gitChangeRow(page, 'notes.md').click()
      await selectors.editorSurface(page).first().waitFor({ timeout: 30_000 })
      await page.reload({ waitUntil: 'commit' })
      await selectors.editorSurface(page).first().waitFor({ timeout: 30_000 })
      await step('direct-file-reload')
      await page.goto(sessionHref, { waitUntil: 'commit' })
      await selectors.phoneHeaderAction(page, 'Terminal').click()
      await selectors.phoneTerminalCanvas(page).waitFor({ timeout: 30_000 })
      await page.reload({ waitUntil: 'commit' })
      await selectors.phoneTerminalCanvas(page).waitFor({ timeout: 30_000 })
      await step('direct-terminal-reload')
      await page.goto(new URL('/', page.url()).href, { waitUntil: 'commit' })
      await selectors.phoneLevel(page, 'sessions').waitFor({ timeout: 10_000 })
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      await page.waitForTimeout(1_000)
      const cachedRoot = await startupSnapshot(page)
      await expectConversationUnloaded(page)
      await step('cached-root-list')
      report = {
        list,
        firstSession,
        firstPressMs: firstSession.readyMs - pressedAt,
        directSession,
        cachedRoot,
      }
      await cdp.detach()
    } catch (error) {
      await step('failed')
      throw error
    } finally {
      await releaseFixture(fixture)
    }
  },
  inspect: async () => report,
}

function startupSnapshot(page: Page) {
  return page.evaluate(() => ({
    readyMs: performance.now(),
    document: performance.getEntriesByType('navigation').map((entry) => {
      const navigation = entry as PerformanceNavigationTiming
      return { encoded: navigation.encodedBodySize, transfer: navigation.transferSize }
    }),
    resources: performance.getEntriesByType('resource').map((entry) => {
      const resource = entry as PerformanceResourceTiming
      return {
        name: resource.name,
        start: resource.startTime,
        end: resource.responseEnd,
        encoded: resource.encodedBodySize,
      }
    }),
  }))
}

function conversationResources(page: Page) {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) =>
        /\/(?:phone-session|session-screen)-[^/]+\.js(?:\?|$)|\/features\/phone\/components\/session-screen\.tsx(?:\?|$)/.test(
          entry.name,
        ),
      )
      .map((entry) => entry.name),
  )
}

async function expectConversationUnloaded(page: Page) {
  const fetched = await conversationResources(page)
  equal(fetched.length, 0, `Sessions list downloaded conversation code: ${fetched.join(', ')}`)
}
