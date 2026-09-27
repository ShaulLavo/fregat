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
  run: (page, context) => runStartup(page, context, true),
  inspect: async () => report,
}

export const phoneStartupTiming: Scenario = {
  ...phoneStartupNavigation,
  name: 'phone-startup-timing',
  description:
    'Cold list, background conversation download, warm and immediate first press, and direct session reload.',
  run: (page, context) => runStartup(page, context, false),
}

async function runStartup(
  page: Page,
  { step, evidence }: Parameters<Scenario['run']>[1],
  routes: boolean,
) {
  page.setDefaultTimeout(30_000)
  const fixture = await createModifiedFileFixture('phone-startup', 'notes.md', ['one'], ['two'])
  try {
    const base = await openFixtureChat(page, fixture)
    await createSessions(page, base, fixture)
    await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
    const cdp =
      page.context().browser()?.browserType().name() === 'chromium'
        ? await page.context().newCDPSession(page)
        : null
    await cdp?.send('Network.enable')
    await cdp?.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp?.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 1_125_000,
      uploadThroughput: 187_500,
    })
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await observeListReady(page)
    await page.reload({ waitUntil: 'commit' })
    await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
    const list = await startupSnapshot(page)
    await step('cold-list')
    await page.waitForTimeout(1_000)
    const background = await expectBackgroundReady(page)
    await step('background-ready')
    const pressedAt = await page.evaluate(() => performance.now())
    await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
    await selectors.chatMessage(page).waitFor()
    const firstSession = await startupSnapshot(page)
    ok(
      (await conversationResources(page)).length > 0,
      'Conversation code must be observable after the first press',
    )
    await expectWarmReuse(page, background)
    await step('first-session')
    await page.reload({ waitUntil: 'commit' })
    await selectors.chatMessage(page).waitFor()
    const directSession = await startupSnapshot(page)
    ok(
      (await conversationResources(page)).length > 0,
      'Direct session must load its conversation code',
    )
    await step('direct-session-reload')
    report = {
      list,
      background,
      firstSession,
      firstPressMs: firstSession.readyMs - pressedAt,
      directSession,
    }
    await evidence.json('initial-navigation.json', report)
    if (!routes) {
      await selectors.phoneBack(page).click()
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      await page.reload({ waitUntil: 'commit' })
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).waitFor()
      const immediateList = await startupSnapshot(page)
      const immediatePressedAt = await page.evaluate(() => performance.now())
      await selectors.sessionByTitle(page, PHONE_SESSIONS[0]!).click()
      await selectors.chatMessage(page).waitFor()
      const immediateSession = await startupSnapshot(page)
      report = {
        list,
        background,
        firstSession,
        firstPressMs: firstSession.readyMs - pressedAt,
        directSession,
        immediateList,
        immediateSession,
        immediatePressMs: immediateSession.readyMs - immediatePressedAt,
      }
      await step('immediate-session')
      await cdp?.detach()
      return
    }
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
    await expectBackgroundReady(page)
    await step('cached-root-list')
    report = {
      list,
      background,
      firstSession,
      firstPressMs: firstSession.readyMs - pressedAt,
      directSession,
      cachedRoot,
    }
    await cdp?.detach()
  } catch (error) {
    await step('failed')
    throw error
  } finally {
    await releaseFixture(fixture)
  }
}

function startupSnapshot(page: Page) {
  return page.evaluate(() => ({
    readyMs: performance.now(),
    listReadyMs: performance.getEntriesByName('phone:list-ready')[0]?.startTime ?? null,
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

async function observeListReady(page: Page) {
  await page.addInitScript((selector) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return
      performance.mark('phone:list-ready')
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  }, selectors.sessionTitleSelector(PHONE_SESSIONS[0]!))
}

async function expectBackgroundReady(page: Page) {
  const built = await page.evaluate(() => {
    const source = document.getElementById('shell-chunks')?.textContent
    return source ? Array.isArray(JSON.parse(source).session) : false
  })
  if (!built) return null
  await page.waitForFunction(
    () => {
      const links = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[data-phone-warm-session]'),
      )
      return (
        links.length > 0 &&
        links.every((link) => performance.getEntriesByName(link.href).length > 0)
      )
    },
    undefined,
    { timeout: 30_000 },
  )
  const background = await page.evaluate(() => ({
    readyMs: performance.getEntriesByName('phone:list-ready')[0]?.startTime ?? 0,
    resources: Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[data-phone-warm-session]'),
      (link) => ({
        href: link.href,
        priority: link.fetchPriority,
        rel: link.rel,
        requests: performance.getEntriesByName(link.href).map((entry) => ({
          start: entry.startTime,
          end: (entry as PerformanceResourceTiming).responseEnd,
          encoded: (entry as PerformanceResourceTiming).encodedBodySize,
        })),
      }),
    ),
  }))
  ok(background.readyMs > 0, 'List readiness must be observed')
  ok(
    background.resources.every((resource) => resource.priority === 'low'),
    'Background hints must use low priority',
  )
  ok(
    background.resources.every((resource) =>
      resource.requests.every((request) => request.start >= background.readyMs),
    ),
    'Conversation requests must follow list readiness',
  )
  return background
}

async function expectWarmReuse(
  page: Page,
  background: Awaited<ReturnType<typeof expectBackgroundReady>>,
) {
  if (!background) return
  for (const resource of background.resources) {
    const count = await page.evaluate(
      (href) => performance.getEntriesByName(href).length,
      resource.href,
    )
    equal(
      count,
      resource.requests.length,
      `Conversation press downloaded prepared resource again: ${resource.href}`,
    )
  }
}
