import { createBrowserDispatcher, type CommandHandler } from '@fregat/hotkeys'
import { EDITOR_COMMANDS } from './editor/commandCatalog'
import type { EditorAnyCommandId } from './editor/commandCatalog'
import type { EditorCommandHandler } from './plugins'
import type { EditorDisposable } from './editor/disposables'
import type { EditorKeymapNodeOptions } from './editor/hotkeys'
import { editorKeymapBindings } from './keymap/presets'

export type TestKeymap = {
  registerKeymapContextKey(key: string, read: () => boolean): EditorDisposable
  registerKeymapNode(options: EditorKeymapNodeOptions): EditorDisposable
  dispose(): void
}

/** The same bindings, live context and command ownership as a standalone editor. */
export function createTestKeymap(
  root: HTMLElement,
  commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>,
): TestKeymap {
  const keys = new Map<string, () => boolean>()
  const mounted = !root.isConnected
  if (mounted) root.ownerDocument.body.append(root)
  const dispatcher = createBrowserDispatcher({
    root: root.ownerDocument,
    platform: 'linux',
    keymap: editorKeymapBindings({}, 'linux'),
  })
  const handlers: Record<string, CommandHandler<KeyboardEvent>> = {}
  for (const command of new Set([...EDITOR_COMMANDS.map((entry) => entry.id), ...commands.keys()]))
    handlers[command] = ({ source }) =>
      commands.get(command)?.(source ? { event: source } : {}) ?? false
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
    registerKeymapNode: (options) => {
      const child = dispatcher.createNode({
        parent: node,
        commands: options.commands,
        ...(typeof options.context === 'string'
          ? { context: options.context }
          : { readContext: options.context }),
      })
      const detach = dispatcher.attachElement(child, options.element)
      return {
        dispose: () => {
          detach()
          child.remove()
        },
      }
    },
    registerKeymapContextKey: (key, read) => {
      keys.set(key, read)
      return { dispose: () => keys.delete(key) }
    },
    dispose: () => {
      node.remove()
      dispatcher.dispose()
      if (mounted) root.remove()
    },
  }
}
