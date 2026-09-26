import {
  browserEngine,
  browserEngineName,
  browserKeeps,
} from '@workspace/client-core/commands/browser-kept'
import { chordStrokes, type PlatformName } from '@workspace/client-core/commands/chord'

import { formatChord } from '@/keymap/utils/format-keys'

/** A sentence for a chord this browser acts on before the page sees it, or null. */
export function useBrowserKept(platform: PlatformName): (keys: string) => string | null {
  const engine = browserEngine(navigator.userAgent, navigator.maxTouchPoints)
  const standalone = matchMedia('(display-mode: standalone)').matches

  return (keys) => {
    if (engine === null || !browserKeeps(keys, engine, standalone, platform)) return null

    const first = formatChord(chordStrokes(keys)[0] ?? keys, platform)
    const kept = `${browserEngineName(engine)} acts on ${first} before the page sees it`
    if (engine === 'chromium') return `${kept}; the installed app window receives it`

    return kept
  }
}
