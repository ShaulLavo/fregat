import { useMemo } from 'react'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { createUnicodeHoverPlugin } from '@/features/editor/state/unicode-hover-plugin'

export function useUnicodeHighlights() {
  const ambiguous = useSettingValue('editor.unicodeHighlight.ambiguousCharacters')
  const invisible = useSettingValue('editor.unicodeHighlight.invisibleCharacters')
  const allowedCharacters = useSettingValue('editor.unicodeHighlight.allowedCharacters')
  const bus = useCommandBus()
  // The plugin registers a hover participant, so its identity controls that registration.
  const plugin = useMemo(
    () =>
      createUnicodeHoverPlugin(() => {
        bus.dispatch('workspace.showUnicodeSettings', {
          source: { kind: 'programmatic', caller: 'editor.unicode-highlight' },
        })
      }),
    [bus],
  )
  return {
    plugin,
    options: {
      ambiguous,
      invisible,
      allowedCodePoints: Array.from(
        allowedCharacters,
        (character) => character.codePointAt(0) ?? 0,
      ),
    },
  }
}
