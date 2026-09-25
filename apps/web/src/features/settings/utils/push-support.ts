export type PushSupport = 'supported' | 'unsupported' | 'needs-install' | 'scope-taken'

/** The browser facts push support depends on, read once so the verdict stays a pure function. */
export type PushEnvironment = {
  readonly secure: boolean
  readonly serviceWorker: boolean
  readonly pushManager: boolean
  readonly notification: boolean
  readonly userAgent: string
  readonly maxTouchPoints: number
  readonly standalone: boolean
  /** The script of the service worker controlling this page, if any. */
  readonly controllerScript: string | null
  readonly workerScript: string
}

/** The push worker is `sw.js` at the app base, and the base is its scope. */
export function pushWorkerScript(base = import.meta.env.BASE_URL) {
  return `${base}sw.js`
}

// The worker's query carries this device's label, which a renewed subscription registers under.
function workerPath(scriptURL: string) {
  const url = new URL(scriptURL)
  url.search = ''
  return url.href
}

export function readPushEnvironment(): PushEnvironment {
  return {
    secure: window.isSecureContext,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: typeof Notification !== 'undefined',
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(),
    controllerScript: navigator.serviceWorker?.controller?.scriptURL ?? null,
    workerScript: new URL(pushWorkerScript(), window.location.href).href,
  }
}

export function pushSupport(environment: PushEnvironment): PushSupport {
  // The demo's mock backend owns the scope; registering ours would replace it.
  if (
    environment.controllerScript &&
    workerPath(environment.controllerScript) !== environment.workerScript
  )
    return 'scope-taken'
  if (isAppleMobile(environment) && !environment.standalone) return 'needs-install'
  if (!environment.secure || !environment.serviceWorker) return 'unsupported'
  if (!environment.pushManager || !environment.notification) return 'unsupported'

  return 'supported'
}

/** A name for this browser in the device list, such as “Chrome on Linux”. */
export function deviceLabel(environment: Pick<PushEnvironment, 'userAgent' | 'maxTouchPoints'>) {
  return `${browserName(environment.userAgent)} on ${platformName(environment)}`
}

function browserName(userAgent: string) {
  if (/Edg(?:e|A|iOS)?\//.test(userAgent)) return 'Edge'
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox'
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'Chrome'
  if (/Safari\//.test(userAgent)) return 'Safari'

  return 'Browser'
}

function platformName(environment: Pick<PushEnvironment, 'userAgent' | 'maxTouchPoints'>) {
  const { userAgent } = environment
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone'
  if (isAppleMobile(environment)) return 'iPad'
  if (/Android/.test(userAgent)) return 'Android'
  if (/CrOS/.test(userAgent)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS'
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/Linux/.test(userAgent)) return 'Linux'

  return 'this device'
}

// iPadOS reports a Mac user agent; touch points tell the two apart.
function isAppleMobile(environment: Pick<PushEnvironment, 'userAgent' | 'maxTouchPoints'>) {
  if (/iPhone|iPad|iPod/.test(environment.userAgent)) return true

  return /Macintosh/.test(environment.userAgent) && environment.maxTouchPoints > 1
}

function isStandalone() {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true

  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}
