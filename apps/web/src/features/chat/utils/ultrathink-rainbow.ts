import type { EditorRangeDecoration } from '@singapore-editor/core/editor'

import { ultrathinkMatch } from '@/features/chat/utils/effort-tier'

const RAINBOW_STOPS = 7

/** One decoration per letter of the first whole-word "ultrathink", walking the rainbow stops. */
export function ultrathinkRainbow(prompt: string): readonly EditorRangeDecoration[] {
  const match = ultrathinkMatch(prompt)
  if (!match) return []

  const letters = match.end - match.start
  return Array.from({ length: letters }, (_, index) => {
    const stop = 1 + Math.round((index * (RAINBOW_STOPS - 1)) / Math.max(1, letters - 1))
    return {
      end: match.start + index + 1,
      start: match.start + index,
      style: { color: `var(--rainbow-${stop})` },
    }
  })
}
