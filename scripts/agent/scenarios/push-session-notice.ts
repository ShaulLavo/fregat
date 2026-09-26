import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { pushDeviceId } from '../../../packages/contracts/src/index'
import { createPushSubscriber } from '../../../apps/server/test/factories/push-subscriber'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import type { Scenario } from './index'
import {
  isolatedNativeScenario,
  restoreUserSettings,
  settingsSnapshot,
} from './native-provider-verification'
import {
  stubPushManager,
  waitFor,
  waitForNotification,
  watchWorkerRegistrations,
} from './push-subscribe'

type Notice = { title: string; body: string; tag: string; path: string }

const KEYS = ['chat.pushNotifications'] as const

const scenario = isolatedNativeScenario({
  name: 'push-session-notice',
  description:
    'With push on and this browser registered, a completed turn pushes nothing while the page is focused and one encrypted notice once it is backgrounded; the worker shows it, and its click opens the session route.',
  fixture: new URL('../fixtures/native-titles.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId }) {
    const title = `push-session-notice verification ${sessionId.slice(0, 8)}`
    const pushed: Uint8Array[] = []
    const pushService = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        pushed.push(new Uint8Array(await request.arrayBuffer()))
        return new Response(null, { status: 201 })
      },
    })
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const endpoint = `https://fcm.googleapis.com/platform-agent/${pushService.port}/push/session-notice`
    try {
      await drive(page, {
        step,
        control: (mode) =>
          writeFile(
            join(root, 'title-control.json'),
            JSON.stringify({ mode, holdConversation: true }),
          ),
        endpoint,
        pushed,
        sessionId,
        title,
        orchestration,
      })
    } finally {
      await pushService.stop(true)
      await page.request.delete(`${base}/push/devices/${await pushDeviceId(endpoint)}`, {
        headers: { Origin: new URL(page.url()).origin },
      })
      await restoreUserSettings(page, base, before, KEYS)
    }
  },
})

export const pushSessionNotice: Scenario = { ...scenario, notifications: true }

async function drive(
  page: Page,
  input: {
    step: (name: string) => Promise<void>
    control: (mode: 'hold' | 'success') => Promise<void>
    endpoint: string
    pushed: Uint8Array[]
    sessionId: string
    title: string
    orchestration: string
  },
) {
  const { step, control, endpoint, pushed, sessionId } = input
  const turns: Turns = {
    control,
    title: input.title,
    orchestration: input.orchestration,
    sessionId,
  }
  const subscriber = createPushSubscriber(endpoint)
  const deviceId = await pushDeviceId(endpoint)
  const sessionUrl = page.url()
  await page.addInitScript(stubPushManager, subscriber.subscription)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const worker = await watchWorkerRegistrations(page)
  await selectors.chatMessage(page).waitFor({ timeout: 45_000 })

  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('push')
  await selectors.pushTurnOn(page).click()
  await selectors.pushDeviceRow(page, deviceId).waitFor({ timeout: 15_000 })
  await selectors.pushSessionSwitch(page).click()
  await waitFor(async () =>
    (await selectors.pushSessionSwitch(page).getAttribute('aria-checked')) === 'true'
      ? true
      : undefined,
  )
  await selectors.pushSection(page).scrollIntoViewIfNeeded()
  await step('push-on')

  await page.goto(sessionUrl)
  await selectors.chatMessage(page).waitFor({ timeout: 45_000 })
  await runTurn(page, turns, 'Complete the focused push turn.')
  await Bun.sleep(1500)
  strictEqual(pushed.length, 0, 'A focused window holds the push')
  await step('focused-no-push')

  await startTurn(page, turns, 'Complete the background push turn.')
  const scope = new URL('/', page.url()).href
  let notice: Notice | null = null
  let plaintext = ''
  const background = await page.context().newPage()
  try {
    await background.goto('about:blank')
    const source = await page.context().newCDPSession(page)
    await source.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await background.bringToFront()
    const focus = await page.evaluate(() => ({
      visible: document.visibilityState,
      focused: document.hasFocus(),
    }))
    ok(
      focus.visible !== 'visible' || !focus.focused,
      `Source must be backgrounded: ${JSON.stringify(focus)}`,
    )
    await control('success')
    const body = await waitFor(() => pushed[0], 30_000)
    strictEqual(pushed.length, 1, 'One push per completed turn')
    plaintext = subscriber.decrypt(body)
    notice = JSON.parse(plaintext) as Notice
    strictEqual(notice.title, 'Session completed')
    ok(notice.tag.endsWith(`:${sessionId}`), `Tag names the session: ${notice.tag}`)
    ok(
      new RegExp(`^~[^/]+/chat/t/${sessionId}$`).test(notice.path),
      `Path opens the session: ${notice.path}`,
    )
    await step('background-push')

    await worker.deliver(scope, plaintext)
    const shown = await waitForNotification(page, scope, notice.tag)
    strictEqual(shown.title, 'Session completed')
    strictEqual(shown.body, notice.body)
    await step('worker-shows-notice')
  } finally {
    await background.close()
  }
  await page.bringToFront()
  ok(notice, 'A notice was pushed')
  const sessionHref = new URL(notice.path, scope).href

  await page.goto(scope)
  await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
  const elsewhere = await clickNotice(page, notice)
  deepStrictEqual(
    elsewhere,
    [{ open: sessionHref }],
    'With no window on the session, the click opens it',
  )
  await page.goto(sessionHref)
  await selectors.chatMessage(page).waitFor({ timeout: 45_000 })
  ok(
    page.url().includes(`/chat/t/${sessionId}`),
    `The opened route shows the session: ${page.url()}`,
  )
  await step('click-opens-session')

  await worker.deliver(scope, plaintext)
  await waitForNotification(page, scope, notice.tag)
  const showing = await clickNotice(page, notice)
  strictEqual(showing.length, 1, `One click call: ${JSON.stringify(showing)}`)
  strictEqual(
    new URL(showing[0]?.focus ?? scope).pathname,
    new URL(sessionHref).pathname,
    'A window on the session is focused',
  )
  await step('click-focuses-session')
}

type Turns = {
  readonly control: (mode: 'hold' | 'success') => Promise<void>
  readonly title: string
  readonly orchestration: string
  readonly sessionId: string
}

async function startTurn(page: Page, turns: Turns, text: string) {
  await turns.control('hold')
  await selectors.chatMessage(page).fill(text)
  await selectors.chatSend(page).click()
  await selectors.sessionStatus(page, turns.title, 'Working').waitFor({ timeout: 30_000 })
}

async function completedTurns(page: Page, turns: Turns) {
  const shell = await readShell(page, turns.orchestration)
  const session = shell.sessions.find((candidate) => candidate.id === turns.sessionId)
  return session?.latestTurn?.state === 'completed' ? session.latestTurn.turnId : undefined
}

async function runTurn(page: Page, turns: Turns, text: string) {
  const previous = await completedTurns(page, turns)
  await startTurn(page, turns, text)
  await turns.control('success')
  await waitFor(async () => {
    const latest = await completedTurns(page, turns)
    return latest && latest !== previous ? latest : undefined
  }, 30_000)
}

type ClickCall = { readonly open?: string; readonly focus?: string }

/**
 * A script cannot make a trusted notification click, and an untrusted one may not open or focus a
 * window. So the worker's `openWindow` and `focus` record their calls, and the scenario acts on them.
 */
async function clickNotice(page: Page, notice: Notice): Promise<ClickCall[]> {
  const worker = page
    .context()
    .serviceWorkers()
    .find((candidate) => new URL(candidate.url()).pathname.endsWith('/sw.js'))
  ok(worker, 'The push worker is running')
  const calls = await worker.evaluate(`(async () => {
    const calls = []
    const open = self.clients.openWindow
    const focus = WindowClient.prototype.focus
    self.clients.openWindow = async (url) => { calls.push({ open: url }); return null }
    WindowClient.prototype.focus = async function () { calls.push({ focus: this.url }); return this }
    try {
      const [notification] = await self.registration.getNotifications({ tag: ${JSON.stringify(notice.tag)} })
      if (!notification) return calls
      self.dispatchEvent(new NotificationEvent('notificationclick', { notification }))
      await new Promise((resolve) => setTimeout(resolve, 500))
      return calls
    } finally {
      self.clients.openWindow = open
      WindowClient.prototype.focus = focus
    }
  })()`)
  ok(Array.isArray(calls), 'The worker reported its click')
  return calls as ClickCall[]
}
