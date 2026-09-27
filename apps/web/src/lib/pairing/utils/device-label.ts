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
