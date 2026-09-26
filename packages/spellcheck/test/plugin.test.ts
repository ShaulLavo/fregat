import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import { setHighlightRegistry } from '@singapore-editor/core/testing'
import { EDITOR_SPELLCHECK_FEATURE, type EditorSpellcheckFeature } from '../src/feature'
import { createSpellcheckPlugin } from '../src/plugin'
import { FakeChecker } from './fakeChecker'

type Painted = readonly { readonly start: number; readonly end: number }[]

class TestHighlight extends Set<Range> {}
const editors: Editor[] = []

beforeEach(() => {
  vi.stubGlobal('Highlight', TestHighlight)
  setHighlightRegistry({ delete: () => true, set: () => undefined })
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.unstubAllGlobals()
})

function mount(checker: FakeChecker, text: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const editor = new Editor(container, { plugins: [createSpellcheckPlugin({ service: checker })] })
  const view = Reflect.get(editor, 'view') as {
    setScrollMetrics(top: number, height: number, width: number): void
    setRangeHighlight(name: string, ranges: Painted, style: unknown): void
    clearRangeHighlight(name: string): void
  }
  const painted: { ranges: Painted } = { ranges: [] }
  const set = view.setRangeHighlight.bind(view)
  const clear = view.clearRangeHighlight.bind(view)
  view.setRangeHighlight = (name, ranges, style) => {
    if (name.endsWith('-spelling'))
      painted.ranges = ranges.map(({ start, end }) => ({ start, end }))
    set(name, ranges, style)
  }
  view.clearRangeHighlight = (name) => {
    if (name.endsWith('-spelling')) painted.ranges = []
    clear(name)
  }
  view.setScrollMetrics(0, 240, 640)
  editor.setText(text)
  editors.push(editor)
  const feature = editor.getFeature(EDITOR_SPELLCHECK_FEATURE) as EditorSpellcheckFeature
  return { editor, feature, painted }
}

function marked(text: string, painted: Painted): readonly string[] {
  return painted.map(({ start, end }) => text.slice(start, end))
}

describe('spellcheck plugin', () => {
  it('marks the misspelled words once the checker answers', async () => {
    const checker = new FakeChecker(['befor', 'arround'])
    const text = 'the list settles befor the cursor moves arround'
    const { feature, painted } = mount(checker, text)
    expect(painted.ranges).toEqual([])
    await checker.answerAll()

    expect(marked(text, painted.ranges)).toEqual(['befor', 'arround'])
    expect(feature.issueAt(text.indexOf('befor') + 2)).toEqual({
      start: 17,
      end: 22,
      word: 'befor',
    })
    expect(feature.issueAt(0)).toBeNull()
  })

  it('paints a reply that lands after an edit at the offsets the text has now', async () => {
    const checker = new FakeChecker(['befor'])
    const { editor, painted } = mount(checker, 'settles befor the cursor')
    expect(checker.checks).toHaveLength(1)

    editor.edit({ from: 0, to: 0, text: 'it all ' })
    editor.setSelection(0)
    await checker.answerAll()

    expect(painted.ranges).toEqual([{ start: 15, end: 20 }])
  })

  it('drops the mark on a word an edit changed while its check was in flight', async () => {
    const checker = new FakeChecker(['befor'])
    const { editor, painted } = mount(checker, 'settles befor the cursor')
    editor.edit({ from: 13, to: 13, text: 'e' })
    editor.setSelection(0)
    await checker.answerAll()

    expect(painted.ranges).toEqual([])
  })

  it('holds back the word being typed until the caret leaves it', async () => {
    const checker = new FakeChecker(['befor'])
    const { editor, painted } = mount(checker, 'the list ')
    await checker.answerAll()
    for (const character of 'befor') {
      const end = editor.getState().length
      editor.edit({ from: end, to: end, text: character })
      editor.setSelection(end + 1)
      await checker.answerAll()
      expect(painted.ranges).toEqual([])
    }

    editor.edit({ from: 14, to: 14, text: ' ' })
    editor.setSelection(15)
    await checker.answerAll()
    expect(painted.ranges).toEqual([{ start: 9, end: 14 }])
  })

  it('keeps the mark on a misspelled word the caret is only moved into', async () => {
    const checker = new FakeChecker(['befor'])
    const { editor, feature, painted } = mount(checker, 'settles befor the cursor')
    await checker.answerAll()
    editor.setSelection(10)

    expect(painted.ranges).toEqual([{ start: 8, end: 13 }])
    expect(await feature.suggestions(10)).toEqual(['before', 'befog'])
  })

  it('replaces the marked word as its own undo step', async () => {
    const checker = new FakeChecker(['befor'])
    const text = 'settles befor the cursor'
    const { editor, feature } = mount(checker, text)
    await checker.answerAll()

    expect(feature.replace(9, 'before')).toBe(true)
    expect(editor.materializeFullText()).toBe('settles before the cursor')
    expect(feature.replace(0, 'x')).toBe(false)

    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe(text)
  })

  it('stops marking accepted words', async () => {
    const checker = new FakeChecker(['fregat'])
    const { feature, painted } = mount(checker, 'ship fregat today')
    await checker.answerAll()
    expect(painted.ranges).toEqual([{ start: 5, end: 11 }])

    feature.setAcceptedWords(['fregat'])
    expect(painted.ranges).toEqual([])
  })

  it('rechecks cached correct verdicts when an accepted word is removed', async () => {
    const checker = new FakeChecker(['fregat'])
    checker.setAcceptedWords(['fregat'])
    const { feature, painted } = mount(checker, 'ship fregat today')
    await checker.answerAll()
    expect(painted.ranges).toEqual([])

    feature.setAcceptedWords([])
    await checker.answerAll()
    expect(painted.ranges).toEqual([{ start: 5, end: 11 }])
  })

  it('ignores an accepted-dictionary reply that lands after the dictionary changes', async () => {
    const checker = new FakeChecker(['fregat'])
    checker.setAcceptedWords(['fregat'])
    const { feature, painted } = mount(checker, 'ship fregat today')
    const oldCheck = checker.checks.shift()!
    feature.setAcceptedWords([])
    await checker.answerAll()
    oldCheck.answer()
    await Promise.resolve()
    expect(painted.ranges).toEqual([{ start: 5, end: 11 }])
  })

  it('replaces a curly-apostrophe misspelling and undoes it', async () => {
    const checker = new FakeChecker(["wrold's"])
    const text = 'the wrold’s end'
    const { editor, feature, painted } = mount(checker, text)
    await checker.answerAll()
    expect(marked(text, painted.ranges)).toEqual(['wrold’s'])
    expect(feature.replace(6, "world's")).toBe(true)
    expect(editor.materializeFullText()).toBe("the world's end")
    editor.dispatchCommand('undo')
    expect(editor.materializeFullText()).toBe(text)
  })

  it('rechecks cached verdicts when fresh captures exclude an edited code span', async () => {
    const checker = new FakeChecker(['befor'])
    const { editor, feature, painted } = mount(checker, 'say befor today')
    editor.setText('say befor today', { languageId: 'markdown' })
    editor['setSyntaxCaptures']([])
    await checker.answerAll()
    expect(feature.issueAt(5)?.word).toBe('befor')

    editor.edit([
      { from: 4, to: 4, text: '`' },
      { from: 9, to: 9, text: '`' },
    ])
    editor.setSelection(0)
    editor['setSyntaxCaptures']([])
    expect(feature.issueAt(6)?.word).toBe('befor')
    editor['setSyntaxCaptures']([{ startIndex: 4, endIndex: 11, captureName: 'text.literal' }])
    expect(painted.ranges).toEqual([])
    expect(feature.issueAt(6)).toBeNull()
  })

  it('never checks a span an inline replacement stands in for', async () => {
    const checker = new FakeChecker(['srcc', 'befor'])
    const text = 'ask @srcc/foo.ts befor'
    const { editor, painted } = mount(checker, text)
    editor.setInlineReplacementProvider(() => [
      { id: 'chip', startIndex: 4, endIndex: 16, text: 'chip' },
    ])
    await checker.answerAll()

    expect(checker.checks).toHaveLength(0)
    expect(marked(text, painted.ranges)).toEqual(['befor'])
  })
})
