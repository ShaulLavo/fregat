import { compileKeymap, detectPlatform, type KeymapPlatform } from '@fregat/hotkeys'
import { baseEditorKeymap, defaultEditorPacks } from '../../src/keymap/presets'
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
  return defaultKeyBindings(platform)
    .filter(
      (binding) =>
        isEditorCommandId(binding.command) && !editorCommandDeclaration(binding.command).mutates,
    )
    .map((binding) => binding.command)
}

export function keyboardEvent(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, init)
  const readModifier = event.getModifierState.bind(event)
  // happy-dom conflates Alt with AltGraph; synthetic shortcuts declare the latter separately.
  Object.defineProperty(event, 'getModifierState', {
    value: (key: string) =>
      key === 'AltGraph' ? (init.modifierAltGraph ?? false) : readModifier(key),
  })
  return event
}
