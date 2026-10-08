const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/EdgiOS|Edg\//, 'Edge'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

/** How a paired device is listed until someone renames it: its system and browser. */
export function deviceLabel(userAgent: string) {
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Device'
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  return browser ? `${system} · ${browser}` : system
}

export type DeviceKind = 'phone' | 'tablet' | 'browser'

/**
 * What the pairing screen calls this device. iPadOS reports itself as a Mac, so a Mac with a touch
 * screen is a tablet.
 */
export function deviceKind(userAgent: string, touchPoints: number): DeviceKind {
  if (/iPhone|Android.+Mobile|Mobile.+Firefox/.test(userAgent)) return 'phone'
  if (/iPad|Android/.test(userAgent)) return 'tablet'
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return 'tablet'
  return 'browser'
}
