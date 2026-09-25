import type { Page } from 'playwright'
import { pushDeviceId } from '../../../packages/contracts/src/index'
import {
  createPushSubscriber,
  verifyVapidAuthorization,
} from '../../../apps/server/test/factories/push-subscriber'
import { createScriptError } from '../../structured-errors'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const DEVICE_LIST = /\/push\/devices(?:\?.*)?$/

type Pushed = { readonly authorization: string | null; readonly body: Uint8Array }

const EXPECTED_NOTICE = {
  title: 'Test notification',
  body: 'Push notifications from this server reach this device.',
  tag: 'push-test',
}

/**
 * Stands in for the browser's push service: headless Chromium has none. `subscribe` hands
 * the app a subscription whose endpoint is the scenario's own HTTP server. The key is kept in
 * sessionStorage, so the subscription survives a reload the way a real one does.
 */
export function stubPushManager(input: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}) {
  const storageKey = '__pushScenarioKey'
  const state: { applicationServerKey: string | null; subscription: unknown } = {
    applicationServerKey: null,
    subscription: null,
  }
  Object.assign(window, { __pushScenario: state })
  const base64Url = (buffer: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  const fromBase64Url = (text: string) =>
    Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
      .buffer
  const subscribeWith = (buffer: ArrayBuffer) => {
    state.applicationServerKey = base64Url(buffer)
    sessionStorage.setItem(storageKey, state.applicationServerKey)
    state.subscription = {
      endpoint: input.endpoint,
      expirationTime: null,
      options: { applicationServerKey: buffer, userVisibleOnly: true },
      getKey: () => null,
      toJSON: () => ({ endpoint: input.endpoint, expirationTime: null, keys: input.keys }),
      unsubscribe: async () => {
        state.subscription = null
        sessionStorage.removeItem(storageKey)
        return true
      },
    }
    return state.subscription as PushSubscription
  }
  const saved = sessionStorage.getItem(storageKey)
  if (saved) subscribeWith(fromBase64Url(saved))
  PushManager.prototype.getSubscription = async () => state.subscription as PushSubscription
  PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
    const key = options?.applicationServerKey
    const buffer = ArrayBuffer.isView(key)
      ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength).slice().buffer
      : (key as ArrayBuffer)
    return subscribeWith(buffer)
  }
}

export const pushSubscribe: Scenario = {
  name: 'push-subscribe',
  notifications: true,
  description:
    'Turn push on from Settings, send a test through the real server route to a local push endpoint, decrypt it, deliver it to the service worker and read the notification it shows.',
  inspect: (page) =>
    page.evaluate(`(() => {
      const state = window.__pushScenario
      return state ? { applicationServerKey: state.applicationServerKey, subscribed: Boolean(state.subscription) } : null
    })()`),
  async run(page, { step }) {
    const pushed: Pushed[] = []
    const pushService = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        pushed.push({
          authorization: request.headers.get('authorization'),
          body: new Uint8Array(await request.arrayBuffer()),
        })
        return new Response(null, { status: 201 })
      },
    })
    try {
      await drive(page, step, `http://127.0.0.1:${pushService.port}/push/scenario-device`, pushed)
    } finally {
      await pushService.stop(true)
    }
  },
}

async function drive(
  page: Page,
  step: (label: string) => Promise<void>,
  endpoint: string,
  pushed: Pushed[],
) {
  const subscriber = createPushSubscriber(endpoint)
  const deviceId = await pushDeviceId(endpoint)
  await page.addInitScript(stubPushManager, subscriber.subscription)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const worker = await watchWorkerRegistrations(page)

  await selectors.windowToolbar(page).waitFor({ timeout: 45_000 })
  // Holds the first device list long enough to photograph the skeleton it stands in for.
  await page.route(DEVICE_LIST, async (route) => {
    await Bun.sleep(1500)
    await route.continue()
  })
  await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill('push')
  await selectors.pushLoadingBar(page).waitFor({ timeout: 15_000 })
  await selectors.pushSection(page).scrollIntoViewIfNeeded()
  await step('loading')
  await page.unroute(DEVICE_LIST)
  await selectors.pushTurnOn(page).waitFor({ timeout: 15_000 })
  await selectors.pushSection(page).scrollIntoViewIfNeeded()
  await step('ready')

  await selectors.pushTurnOn(page).click()
  await selectors.pushDeviceRow(page, deviceId).waitFor({ timeout: 15_000 })
  await selectors.pushThisDeviceOn(page).waitFor()
  await step('subscribed')

  await selectors.pushDeviceAction(page, deviceId, 'Send test').click()
  await selectors.pushDeviceSent(page, deviceId).waitFor({ timeout: 15_000 })
  await step('sent')

  const message = pushed.at(-1)
  if (pushed.length !== 1 || !message)
    throw createScriptError(`The push endpoint received ${pushed.length} requests, expected 1.`)
  const serverKey = await page.evaluate('window.__pushScenario.applicationServerKey')
  const claims = await verifyVapidAuthorization(message.authorization, String(serverKey))
  if (!claims) throw createScriptError('The VAPID Authorization header did not verify.')
  const plaintext = subscriber.decrypt(message.body)
  assertNotice(JSON.parse(plaintext))

  const scope = new URL('/', page.url()).href
  await worker.deliver(scope, plaintext)
  const shown = await waitForNotification(page, scope, 'push-test')
  assertNotice(shown)
  await step('delivered')

  await selectors.pushDeviceAction(page, deviceId, 'Remove').click()
  await selectors.pushNoDevices(page).waitFor({ timeout: 15_000 })
  await selectors.pushTurnOn(page).waitFor()
  await step('removed')
}

/** The worker's registration id comes from CDP, which also delivers the push. */
export async function watchWorkerRegistrations(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const registrations = new Map<string, string>()
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const registration of updated) {
      if (registration.isDeleted) registrations.delete(registration.scopeURL)
      else registrations.set(registration.scopeURL, registration.registrationId)
    }
  })
  await cdp.send('ServiceWorker.enable')

  return {
    async deliver(scope: string, data: string) {
      const registrationId = await waitFor(() => registrations.get(scope))
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(scope).origin,
        registrationId,
        data,
      })
    },
  }
}

export async function waitForNotification(page: Page, scope: string, tag: string) {
  return waitFor(() =>
    page.evaluate(
      async ({ scope, tag }) => {
        const registration = await navigator.serviceWorker.getRegistration(scope)
        const [notification] = (await registration?.getNotifications({ tag })) ?? []
        if (!notification) return undefined
        return { title: notification.title, body: notification.body, tag: notification.tag }
      },
      { scope, tag },
    ),
  )
}

export async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(100)
  }
  throw createScriptError(`Timed out after ${timeoutMs}ms waiting for the push to land.`)
}

function assertNotice(notice: Record<string, unknown>) {
  for (const [field, expected] of Object.entries(EXPECTED_NOTICE)) {
    if (notice[field] === expected) continue
    throw createScriptError(`Notification ${field} was ${JSON.stringify(notice[field])}.`)
  }
}
