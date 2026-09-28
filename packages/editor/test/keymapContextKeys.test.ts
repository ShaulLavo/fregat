import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Editor, EditorOptions } from '../src/editor'
import type { EditorPlugin } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
import { defaultEditorKeyBindings, vscodeEditorKeyBindings } from '../src/keymap/presets'
import { createVisibleEditor } from './factories/visibleEditor'

const editors: Editor[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry(new Map())
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mountEditor(options: EditorOptions = {}): Editor {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = createVisibleEditor(container, options)
  editor.setText('alpha\nbeta')
  editors.push(editor)
  return editor
}

/** A widget the way a plugin owns one: a context key for its state and a command that closes it. */
function widgetPlugin(widget: { open: boolean }, hide: () => boolean): EditorPlugin {
  return {
    activate: (context) => [
      context.registerViewContribution({
        createContribution: (view) => {
          const keys = [
            view.registerKeymapContextKey('suggestWidgetVisible', () => widget.open),
            view.registerKeymapContextKey('writable', () => false),
          ]
          return { update() {}, dispose: () => keys.forEach((key) => key.dispose()) }
        },
      }),
      context.registerCommandContribution({
        createContribution: (commands) => commands.registerCommand('hideSuggestWidget', hide),
      }),
    ],
  }
}

function pressEscape(editor: Editor): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  editor.getInputElement().dispatchEvent(event)
  return event
}

test('a binding conditioned on a plugin’s key runs only while the plugin says it holds', () => {
  const widget = { open: false }
  const hide = vi.fn(() => true)
  const editor = mountEditor({ plugins: [widgetPlugin(widget, hide)] })

  expect(pressEscape(editor).defaultPrevented).toBe(false)
  expect(hide).not.toHaveBeenCalled()

  widget.open = true
  expect(pressEscape(editor).defaultPrevented).toBe(true)
  expect(hide).toHaveBeenCalledTimes(1)
})

test('the editor’s own keys cannot be overridden by a plugin', () => {
  const editor = mountEditor({ plugins: [widgetPlugin({ open: true }, () => true)] })

  expect(editor.getKeymapContext()).toMatchObject({ suggestWidgetVisible: true, writable: true })
})

test('a key goes with the contribution that registered it', () => {
  const editor = mountEditor({ plugins: [widgetPlugin({ open: true }, () => true)] })

  editor.setPlugins([])

  expect(editor.getKeymapContext()).not.toHaveProperty('suggestWidgetVisible')
})

// A condition is any string, so a misspelled key would compile and never match.
test('every condition the presets use names a key the editor or a bundled plugin sets', () => {
  const known = new Set([
    ...['writable', 'hasSelection', 'tabFocusMode', 'inlineSuggestionVisible'],
    'findVisible', // @singapore-editor/find
    'suggestWidgetVisible', // @singapore-editor/lsp-plugin, completion
    'parameterHintsVisible', // @singapore-editor/lsp-plugin, signature help
    'parameterHintsMultipleSignatures',
    'markdown', // @singapore-editor/markdown, authoring
  ])
  const platforms = ['mac', 'windows', 'linux'] as const
  const conditions = platforms.flatMap((platform) =>
    [...defaultEditorKeyBindings(platform), ...vscodeEditorKeyBindings(platform)].flatMap(
      (binding) => binding.when ?? [],
    ),
  )

  const unknown = conditions.filter((condition) => !known.has(condition.replace(/^!/, '')))

  expect(conditions.length).toBeGreaterThan(0)
  expect([...new Set(unknown)]).toEqual([])
})
