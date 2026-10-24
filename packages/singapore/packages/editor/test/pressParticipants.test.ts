import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createEditorLoggingPlugin, type Editor, type EditorOptions } from '../src/editor'
import type { EditorLogEvent, EditorPlugin, EditorPressParticipant } from '../src/plugins'
import { setHighlightRegistry } from '../src/public/testing'
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

function pressPlugin(participant: EditorPressParticipant): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          const registration = view.registerPressParticipant(participant)
          return { update() {}, dispose: () => registration.dispose() }
        },
      }),
  }
}

function press(editor: Editor, detail = 1): MouseEvent {
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail })
  Reflect.get(editor, 'el').dispatchEvent(event)
  return event
}

// The editor focuses its input first thing when it handles a press, so an editor that never took
// focus is one whose press handling never ran; `defaultPrevented` cannot tell, the editor sets it too.
function editorHasFocus(editor: Editor): boolean {
  return Reflect.get(editor, 'el').contains(document.activeElement)
}

test('a claimed press is the participant’s at every click count', () => {
  const editor = mountEditor({ plugins: [pressPlugin(() => true)] })

  for (const detail of [1, 2, 3, 4]) {
    const event = press(editor, detail)
    expect(event.defaultPrevented).toBe(true)
    expect(editorHasFocus(editor)).toBe(false)
  }
})

test('a press nobody claims places the caret as before', () => {
  const seen: number[] = []
  const editor = mountEditor({
    plugins: [pressPlugin((event) => (seen.push(event.detail), false))],
  })

  press(editor)

  expect(seen).toEqual([1])
  expect(editorHasFocus(editor)).toBe(true)
})

test('participants are asked in registration order and the first claim ends it', () => {
  const asked: string[] = []
  const editor = mountEditor({
    plugins: [
      pressPlugin(() => (asked.push('first'), false)),
      pressPlugin(() => (asked.push('second'), true)),
      pressPlugin(() => (asked.push('third'), true)),
    ],
  })

  press(editor)

  expect(asked).toEqual(['first', 'second'])
})

test('a plugin added after the editor was built still gets the press first', () => {
  // A raw listener registered here would run after the editor's own mousedown handler.
  const editor = mountEditor()
  editor.addPlugin(pressPlugin(() => true))

  press(editor)

  expect(editorHasFocus(editor)).toBe(false)
})

test('a participant that throws is logged and the press goes on to the editor', () => {
  const events: EditorLogEvent[] = []
  const editor = mountEditor({
    plugins: [
      createEditorLoggingPlugin((event) => events.push(event)),
      pressPlugin(() => {
        throw new TypeError('broken participant')
      }),
    ],
  })

  press(editor)

  expect(editorHasFocus(editor)).toBe(true)
  expect(events.some((event) => event.action === 'editor.contribution.press_failed')).toBe(true)
})

test('a disposed contribution stops claiming presses', () => {
  const plugin = pressPlugin(() => true)
  const editor = mountEditor({ plugins: [plugin] })

  editor.setPlugins([])
  press(editor)

  expect(editorHasFocus(editor)).toBe(true)
})
