import { normalizedChord, type PlatformName } from '@workspace/client-core/commands/chord'

/** Browsers whose own shortcuts a page never receives, from their sources (docs/ui-research). */
export type BrowserEngine = 'chromium' | 'gecko' | 'webkit-mac' | 'webkit-ipad'

const KEPT: Readonly<Record<BrowserEngine, readonly string[]>> = {
  // An installed app window keeps none of these; see `browserKeeps`.
  chromium: ['Mod+N', 'Mod+T', 'Mod+W', 'Control+Tab', 'Control+Shift+Tab', 'Mod+Shift+T'],
  gecko: ['Mod+N', 'Mod+T', 'Mod+W', 'Mod+Shift+W', 'Mod+Shift+P'],
  'webkit-mac': ['Mod+N', 'Mod+W', 'Mod+Q', 'Mod+T', 'Mod+R', 'Mod+L', 'Control+Tab'],
  'webkit-ipad': [
    'Mod+T',
    'Mod+W',
    'Mod+N',
    'Mod+L',
    'Mod+R',
    'Mod+F',
    'Mod+[',
    'Mod+]',
    'Control+Tab',
    'Mod+Space',
    'Mod+Tab',
    'Mod+Shift+3',
    'Mod+Shift+4',
    'Mod+M',
    'Mod+,',
  ],
}

const ENGINE_NAMES: Readonly<Record<BrowserEngine, string>> = {
  chromium: 'Chrome',
  gecko: 'Firefox',
  'webkit-mac': 'Safari',
  'webkit-ipad': 'iPadOS',
}

/**
 * Whether the browser acts on this chord before the page sees it. Only the first stroke
 * matters: a chord whose first stroke never arrives never starts.
 */
export function browserKeeps(
  keys: string,
  engine: BrowserEngine,
  standalone: boolean,
  platform: PlatformName,
): boolean {
  if (engine === 'chromium' && standalone) return false

  const first = normalizedChord(keys.split(' ')[0] ?? '', platform)

  return KEPT[engine].some((kept) => normalizedChord(kept, platform) === first)
}

export function browserEngineName(engine: BrowserEngine): string {
  return ENGINE_NAMES[engine]
}

/** Null for an engine outside the table, which then keeps nothing we know of. */
export function browserEngine(userAgent: string, maxTouchPoints: number): BrowserEngine | null {
  if (/Firefox\//.test(userAgent)) return 'gecko'
  if (/Chrome\/|Chromium\//.test(userAgent)) return 'chromium'
  if (!/AppleWebKit\//.test(userAgent)) return null
  // iPadOS reports a Mac user agent; touch points tell the two apart.
  if (/iPad/.test(userAgent) || maxTouchPoints > 1) return 'webkit-ipad'

  return 'webkit-mac'
}
