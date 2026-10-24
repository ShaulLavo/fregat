import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { EDITOR_OPTION_DESCRIPTORS } from '../src/editor/optionDescriptors'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'

/**
 * The wrap machinery (WrapMap, setWrapEnabledLayout) was already built and covered; what was
 * missing was any way for a host to turn it on. These cover that seam: the option, the setter, and
 * the command.
 */

const LONG_LINE = `${'word '.repeat(60)}\nsecond line\n`

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

describe('word wrap', () => {
  let container: HTMLElement
  let editor: Editor | null = null

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor?.dispose()
    editor = null
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('is off unless a host asks for it', () => {
    editor = new Editor(container, { defaultText: LONG_LINE })

    expect(editor.isWordWrapEnabled()).toBe(false)
  })

  it('starts enabled when the option is set', () => {
    editor = new Editor(container, { defaultText: LONG_LINE, wordWrap: true })

    expect(editor.isWordWrapEnabled()).toBe(true)
  })

  it('turns on and off through the setter', () => {
    editor = new Editor(container, { defaultText: LONG_LINE })

    expect(editor.setWordWrap(true)).toBe(true)
    expect(editor.isWordWrapEnabled()).toBe(true)

    expect(editor.setWordWrap(false)).toBe(false)
    expect(editor.isWordWrapEnabled()).toBe(false)
  })

  it('toggles through the command router', () => {
    editor = new Editor(container, { defaultText: LONG_LINE })

    expect(editor.dispatchCommand('editor.action.toggleWordWrap')).toBe(true)
    expect(editor.isWordWrapEnabled()).toBe(true)

    editor.dispatchCommand('editor.action.toggleWordWrap')
    expect(editor.isWordWrapEnabled()).toBe(false)
  })

  // A framework binding never names an option; it walks the registry. A setter with no entry
  // beside it is one a host can only reach by holding the editor and calling it, which is exactly
  // what binding through props exists to avoid.
  it('is in the registry a host binding drives options through', () => {
    editor = new Editor(container, { defaultText: LONG_LINE, wordWrap: true })
    const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === 'wordWrap')
    if (!descriptor) throw new Error('wordWrap is not in the option registry')

    descriptor.applyTo(editor, descriptor.validate(false))
    expect(editor.isWordWrapEnabled()).toBe(false)

    // A prop that arrived as anything but a state is a host that has not said which way it wants
    // this, so the editor keeps what it has rather than reading a string as an answer.
    descriptor.applyTo(editor, descriptor.validate('true'))
    expect(editor.isWordWrapEnabled()).toBe(false)
  })

  it('keeps the document text unchanged when wrapping', () => {
    editor = new Editor(container, { defaultText: LONG_LINE })

    editor.setWordWrap(true)

    expect(editor.materializeFullText()).toBe(LONG_LINE)
  })

  it('keeps wrap through simple setText replacements', () => {
    editor = new Editor(container)
    editor.setText(LONG_LINE)
    expect(editor.dispatchCommand('editor.action.toggleWordWrap')).toBe(true)
    editor.setText('replacement text')
    expect(editor.isWordWrapEnabled()).toBe(true)
    expect(editor.materializeFullText()).toBe('replacement text')
  })

  it('retains the user command across native remount of the same logical view', () => {
    const buffer = createEditorTextBuffer(LONG_LINE)
    const session = createEditorBufferSession(buffer)
    editor = new Editor(container, { defaultText: '' })
    editor.attachSession(session)
    expect(editor.isWordWrapEnabled()).toBe(false)
    expect(editor.dispatchCommand('editor.action.toggleWordWrap')).toBe(true)
    expect(editor.isWordWrapEnabled()).toBe(true)
    editor.dispose()

    editor = new Editor(container, { defaultText: '' })
    editor.attachSession(session)
    expect(editor.isWordWrapEnabled()).toBe(true)
    expect(editor.getTextSnapshot()).toBe(buffer.getTextSnapshot())
    expect(buffer.getRevision()).toBe(0)
    expect(buffer.canUndo()).toBe(false)
  })

  it.each([false, true])(
    'honors explicit constructor wrap %s through owned and empty initialization',
    (wordWrap) => {
      const session = createEditorBufferSession(createEditorTextBuffer(LONG_LINE))
      editor = new Editor(container)
      editor.attachSession(session)
      editor.setWordWrap(!wordWrap)
      editor.dispose()

      editor = new Editor(container, { defaultText: '', wordWrap })
      editor.clearDocument()
      editor.attachSession(session)
      expect(editor.isWordWrapEnabled()).toBe(wordWrap)
      editor.setWordWrap(!wordWrap)
      editor.detachSession()
      editor.attachSession(session)
      expect(editor.isWordWrapEnabled()).toBe(!wordWrap)
    },
  )

  it.each([undefined, false])(
    'takes a host setter before external attachment with constructor wrap %s',
    (wordWrap) => {
      const session = createEditorBufferSession(createEditorTextBuffer(LONG_LINE))
      editor = new Editor(container)
      editor.attachSession(session)
      editor.setWordWrap(false)
      editor.dispose()

      editor = new Editor(container, { defaultText: '', wordWrap })
      editor.setWordWrap(true)
      editor.attachSession(session)
      expect(editor.isWordWrapEnabled()).toBe(true)
    },
  )

  it('keeps fresh-session switching behavior and restores each chosen view', () => {
    const first = createEditorBufferSession(createEditorTextBuffer(LONG_LINE))
    const second = createEditorBufferSession(createEditorTextBuffer('second'))
    editor = new Editor(container)
    editor.attachSession(first)
    editor.setWordWrap(true)
    editor.attachSession(second)
    expect(editor.isWordWrapEnabled()).toBe(true)
    editor.setWordWrap(false)
    editor.attachSession(first)
    expect(editor.isWordWrapEnabled()).toBe(true)
    editor.attachSession(second)
    expect(editor.isWordWrapEnabled()).toBe(false)
  })

  it('keeps independent wrap choices for two logical views of one buffer', () => {
    const buffer = createEditorTextBuffer(LONG_LINE)
    const first = createEditorBufferSession(buffer)
    const second = createEditorBufferSession(buffer)
    const otherContainer = document.createElement('div')
    document.body.appendChild(otherContainer)
    const other = new Editor(otherContainer)
    editor = new Editor(container)
    try {
      editor.attachSession(first)
      other.attachSession(second)
      editor.setWordWrap(true)
      expect(other.isWordWrapEnabled()).toBe(false)
      editor.dispose()
      editor = new Editor(container)
      editor.attachSession(first)
      expect(editor.isWordWrapEnabled()).toBe(true)
      expect(other.isWordWrapEnabled()).toBe(false)
      editor.attachSession(second)
      expect(editor.isWordWrapEnabled()).toBe(false)
      expect(buffer.getRevision()).toBe(0)
    } finally {
      other.dispose()
      otherContainer.remove()
    }
  })
})
