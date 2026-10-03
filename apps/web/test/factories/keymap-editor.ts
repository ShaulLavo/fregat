import { Editor, type EditorCommandId, type EditorPlugin } from '@singapore-editor/core'
import type { WindowKeymap } from '@/keymap/state/window-keymap'
import type { FocusService } from '@/lib/focus/state/service'

export function createKeymapEditor(
  focus: FocusService,
  keymap: WindowKeymap,
  options: {
    readonly key: string
    readonly text?: string
    readonly writable?: boolean
    readonly surface?: 'document' | 'settings' | 'diff' | 'search-result'
    readonly plugins?: readonly EditorPlugin[]
  },
) {
  const container = document.createElement('section')
  container.className = 'h-48 w-96'
  document.body.append(container)
  const editor = new Editor(container, {
    defaultText: options.text ?? 'first line\nsecond line\nthird line',
    editability: options.writable === false ? 'readonly' : 'editable',
    plugins: options.plugins,
    hotkeys: keymap.hotkeys,
    hotkeysParent: keymap.parentFor('editor'),
    keymapContext: { mode: options.writable === false ? 'diff' : 'full', extension: 'ts' },
  })
  const dispatched: EditorCommandId[] = []
  const registration = focus.register({
    area: 'editor',
    element: container,
    id: { kind: 'editor', key: options.key, surface: options.surface ?? 'document' },
    capabilities: {
      editor: {
        dispatch: (command, context) => {
          dispatched.push(command)
          return editor.dispatchCommand(command, context)
        },
        getInputElement: () => editor.getInputElement(),
        readKeymapContext: () => editor.getKeymapContext(),
        writable: options.writable !== false,
      },
    },
    onIntent: () => {
      editor.focus()
      return true
    },
  })
  return {
    container,
    dispatched,
    editor,
    dispose: () => {
      registration.unregister()
      editor.dispose()
      container.remove()
    },
  }
}
