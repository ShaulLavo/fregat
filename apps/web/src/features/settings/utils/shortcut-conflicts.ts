import { unique } from '@workspace/utils/collections'

import {
  shortcutPlace,
  shortcutPlacesLabel,
  shortcutTitle,
} from '@/features/settings/utils/shortcut-rows'
import type { LostChord } from '@/keymap/active-bindings'
import type { PlatformCommandId } from '@/keymap/types'

/** Only losses caused by the recorded chord, grouped by command across panes and aliases. */
export function shortcutConflicts(
  lost: readonly LostChord[],
  command: PlatformCommandId,
  keys: string,
) {
  const takes = new Map<PlatformCommandId, string[]>()
  const blockers: PlatformCommandId[] = []
  for (const chord of lost) {
    if (chord.command === command && chord.keys === keys) blockers.push(chord.winner)
    if (chord.winner !== command || chord.winnerKeys !== keys) continue
    takes.set(chord.command, [...(takes.get(chord.command) ?? []), shortcutPlace(chord)])
  }

  return {
    blockedBy: blockers.length > 0 ? [...new Set(blockers)].map(shortcutTitle).join(', ') : null,
    takes: [...takes].map(([id, places]) => ({
      title: shortcutTitle(id),
      where: shortcutPlacesLabel(unique(places)),
    })),
  }
}
