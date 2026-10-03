import { compileKeymap, detectPlatform, type KeymapPlatform } from '@fregat/hotkeys'
import { baseEditorKeymap, defaultEditorPacks, readonlyDiffPack } from '../../src/keymap/presets'
import { editorCommandDeclaration, isEditorCommandId } from '../../src/editor/commandCatalog'

export function defaultKeyBindings(platform: KeymapPlatform = detectPlatform()) {
  const entries = [
    ...baseEditorKeymap[platform],
    ...defaultEditorPacks.flatMap((pack) => pack[platform]),
  ]
  return compileKeymap(entries, platform).bindings.map((binding) => ({
    ...binding.payload.entry,
    keys: binding.chord,
    command: binding.payload.command ?? '',
  }))
}
export function commandCategory(command: string) {
  return isEditorCommandId(command) ? editorCommandDeclaration(command).category : undefined
}
export function readonlyCommands(platform: KeymapPlatform): readonly string[] {
  return readonlyDiffPack[platform].map((binding) => binding.command)
}
