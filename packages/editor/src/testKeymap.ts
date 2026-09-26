import type { EditorAnyCommandId } from './editor/commandCatalog'
import type { EditorCommandHandler, EditorDisposable } from './plugins'
import { editorKeyConditionMatches, type EditorKeymapContext } from './keymap/conditions'
import { defaultEditorKeyBindings, type EditorKeyBinding } from './keymap/presets'
import { createKeymapRuntime } from './keymap/runtime'

export type TestKeymap = {
  registerKeymapContextKey(key: string, read: () => boolean): EditorDisposable
  dispose(): void
}

/**
 * The host's half of the keyboard, as the editor wires it, for a plugin mounted on a test context:
 * the default bindings, the context keys contributions register, and the commands they registered.
 * A key pressed on `root` reaches a plugin only the way it would in an editor.
 */
export function createTestKeymap(
  root: HTMLElement,
  commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>,
): TestKeymap {
  const keys = new Map<string, () => boolean>()
  const captureContext = (): EditorKeymapContext => ({
    ...Object.fromEntries([...keys].map(([key, read]) => [key, read()])),
    writable: true,
    hasSelection: false,
    tabFocusMode: false,
    inlineSuggestionVisible: false,
  })
  const runtime = createKeymapRuntime<EditorKeyBinding, EditorKeymapContext>({
    root,
    platform: 'linux',
    bindings: defaultEditorKeyBindings('linux').map((binding) => ({
      ...binding,
      payload: binding,
    })),
    captureContext,
    isAvailable: ({ payload }, context) =>
      (payload.when ?? []).every((condition) => editorKeyConditionMatches(condition, context)),
    dispatch: ({ payload }, _context, event) => commands.get(payload.command)?.({ event }) ?? false,
  })
  return {
    registerKeymapContextKey: (key, read) => {
      keys.set(key, read)
      return { dispose: () => keys.delete(key) }
    },
    dispose: () => runtime.dispose(),
  }
}
