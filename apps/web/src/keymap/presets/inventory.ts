import { isBindableChord, type PlatformName } from '@workspace/client-core/commands/chord'
import type { KeybindingPreset } from '@workspace/client-core/commands/metadata'
import { isPlatformCommandId } from '@/keymap/table'
import patches from '@/keymap/presets/ours-patches.json'
import zed from '@/keymap/presets/zed.json'

export const ours = zed.map((row, index) => {
  const patch = patches.find((entry) => entry.index === index)
  return patch ? { ...row, ...patch.fields } : row
})

export { zed }

export type UnmappedPresetBinding = {
  readonly platform: string
  readonly context: string
  readonly command: string
  readonly keys: string
  readonly reason: string
}

export function unmappedPresetBindings(
  platform: PlatformName,
  preset: KeybindingPreset,
): readonly UnmappedPresetBinding[] {
  if (preset === 'vscode') return []
  const rows = preset === 'ours' ? ours : zed
  return rows.flatMap((row): UnmappedPresetBinding[] => {
    if (row.platform !== (platform === 'mac' ? 'mac' : 'linux')) return []
    if ('reserved' in row && row.reserved && row.context && row.reason === null) return []
    if (row.command && row.context && isPlatformCommandId(row.command) && isBindableChord(row.keys))
      return []
    return [
      {
        platform,
        context: row.context ?? row.upstreamContext,
        command: row.upstreamCommand,
        keys: row.keys,
        reason:
          row.reason ??
          (isBindableChord(row.keys)
            ? 'The command is unavailable in this client.'
            : 'The key is unavailable in this client.'),
      },
    ]
  })
}
