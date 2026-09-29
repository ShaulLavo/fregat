import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { EDITOR_OPTION_DESCRIPTORS } from '../src/editor/optionDescriptors'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'

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
})
