import { createBrowserDispatcher, type CommandHandler } from '@fregat/hotkeys'
import type { EditorAnyCommandId } from './editor/commandCatalog'
import type { EditorCommandHandler } from './plugins'
import type { EditorDisposable } from './editor/disposables'
import { editorKeymapBindings } from './keymap/presets'

export type TestKeymap = {
  registerKeymapContextKey(key: string, read: () => boolean): EditorDisposable
  dispose(): void
}

/** The same bindings, live context and command ownership as a standalone editor. */
export function createTestKeymap(
  root: HTMLElement,
  commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>,
): TestKeymap {
  const keys = new Map<string, () => boolean>()
  const dispatcher = createBrowserDispatcher({
    root,
    platform: 'linux',
    keymap: editorKeymapBindings({}, 'linux'),
  })
  const handlers: Record<string, CommandHandler<KeyboardEvent>> = {}
  for (const [command, handle] of commands)
    handlers[command] = ({ source }) => handle(source ? { event: source } : {})
  const node = dispatcher.createNode({
    readContext: () => ({
      identifiers: [
        'Editor',
        'writable',
        ...[...keys].filter(([, read]) => read()).map(([key]) => key),
      ],
      values: { mode: 'full' },
    }),
    commands: handlers,
  })
  dispatcher.attachElement(node, root)
  return {
    registerKeymapContextKey: (key, read) => {
      keys.set(key, read)
      return { dispose: () => keys.delete(key) }
    },
    dispose: () => {
      node.remove()
      dispatcher.dispose()
    },
  }
}
