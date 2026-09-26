import { onTestFinished, vi } from 'vitest'

type PushPlatformOptions = {
  /** What `Notification.permission` reads before any prompt. */
  readonly permission?: NotificationPermission
  /** What the prompt answers. */
  readonly answer?: NotificationPermission
  readonly endpoint?: string
  /** Holds `pushManager.subscribe` until the test releases it. */
  readonly holdSubscribe?: boolean
  /** Rejects `pushManager.subscribe` with a DOMException of this name. */
  readonly subscribeError?: string
  /** A subscription this browser already holds, with the key it was made with. */
  readonly existing?: {
    readonly endpoint: string
    readonly applicationServerKey: Uint8Array<ArrayBuffer>
  }
  /** The script of a service worker that already controls the page, as MSW does in the demo. */
  readonly controllerScript?: string
}

type StubSubscription = {
  readonly endpoint: string
  readonly options: { readonly applicationServerKey: ArrayBuffer }
  readonly toJSON: () => PushSubscriptionJSON
  readonly unsubscribe: ReturnType<typeof vi.fn<() => Promise<boolean>>>
}

/**
 * The browser's push platform: a secure context with a service worker container, a push
 * manager and notification permission. The subscription carries a real P-256 key, since
 * the server checks the point before storing it.
 */
export async function installPushPlatform(options: PushPlatformOptions = {}) {
  const endpoint = options.endpoint ?? 'https://fcm.googleapis.com/device-one'
  const keys = await subscriberKeys()
  let subscription: StubSubscription | null = null
  const forget = () => {
    subscription = null
  }
  const existing = options.existing
    ? stubSubscription(
        options.existing.endpoint,
        keys,
        bytes(options.existing.applicationServerKey),
        forget,
      )
    : null
  subscription = existing
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: vi.fn(async ({ applicationServerKey }: PushSubscriptionOptionsInit) => {
      if (options.holdSubscribe) await held
      if (options.subscribeError)
        throw new DOMException('Registration failed', options.subscribeError)
      subscription = stubSubscription(endpoint, keys, bytes(applicationServerKey), forget)
      return subscription
    }),
  }
  const registration = { scope: `${location.origin}/`, pushManager }
  let registered = existing !== null
  const serviceWorker = {
    controller: controllerFor(options.controllerScript),
    ready: Promise.resolve(registration),
    register: vi.fn(async () => {
      registered = true
      return registration
    }),
    getRegistration: async () => (registered ? registration : undefined),
  }
  class NotificationStub {
    static permission: NotificationPermission = options.permission ?? 'default'
    static requestPermission = vi.fn(async () => {
      NotificationStub.permission = options.answer ?? 'granted'
      return NotificationStub.permission
    })
  }
  vi.stubGlobal('Notification', NotificationStub)
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
  onTestFinished(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  return {
    endpoint,
    Notification: NotificationStub,
    pushManager,
    serviceWorker,
    releaseSubscribe: () => release(),
    subscription: () => subscription,
    existing,
  }
}

function controllerFor(scriptURL: string | undefined) {
  if (!scriptURL) return null

  return { scriptURL }
}

function stubSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  applicationServerKey: ArrayBuffer,
  forget: () => void,
): StubSubscription {
  return {
    endpoint,
    options: { applicationServerKey },
    toJSON: () => ({ endpoint, expirationTime: null, keys }),
    unsubscribe: vi.fn(async () => {
      forget()
      return true
    }),
  }
}

async function subscriberKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { p256dh: base64Url(raw), auth: base64Url(crypto.getRandomValues(new Uint8Array(16))) }
}

function bytes(key: PushSubscriptionOptionsInit['applicationServerKey']): ArrayBuffer {
  if (key instanceof ArrayBuffer) return key
  if (ArrayBuffer.isView(key))
    return new Uint8Array(key.buffer, key.byteOffset, key.byteLength).slice().buffer

  return new ArrayBuffer(0)
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
