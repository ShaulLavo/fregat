import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DocumentSessionChange } from '../src/documentSession'
import type { Editor } from '../src/editor/Editor'
import { createVisibleEditor } from './factories/visibleEditor'
import {
  defaultEditorKeyBindings,
  editorCommandPackForCommand,
  editorKeymapLayersForBindings,
} from '../src/editor/keymap'
import { parseSnippet, snippetInitialSelection } from '../src/editor/snippet'
import type { EditorEditContributionContext, EditorPlugin } from '../src/plugins'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import { resolveSelection } from '../src/selections'
import { editorElement } from './editorElement'

/**
 * Inline suggestions the way a source delivers them: a text edit handed to the editor, drawn in the
 * rows the reader is looking at, and taken with the keys they already have their hands on. A
 * suggestion that only a direct call can show or accept would be exactly the thing this is guarding
 * against.
 */

const highlightsMap = new Map<string, unknown>()
const mockRegistry = {
  delete: (name: string) => highlightsMap.delete(name),
  set: (name: string, highlight: unknown) => {
    highlightsMap.set(name, highlight)
  },
}

class MockHighlight extends Set<Range> {}

describe('inline suggestions', () => {
  let container: HTMLElement
  let editor: Editor
  let edits: EditorEditContributionContext | null
  let lastChange: DocumentSessionChange | null

  beforeEach(() => {
    lastChange = null
    highlightsMap.clear()
    // @ts-expect-error — happy-dom has no Highlight constructor
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    edits = null
    container = document.createElement('div')
    document.body.appendChild(container)

    const completionSource: EditorPlugin = {
      name: 'test.inlineSuggestionSource',
      activate: (context) =>
        context.registerEditContribution({
          createContribution: (contributed) => {
            edits = contributed
            return { dispose: () => {} }
          },
        }),
    }

    editor = createVisibleEditor(container, {
      onChange: (_state, change) => {
        if (change) lastChange = change
      },
      plugins: [completionSource],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  it('draws the part of a suggestion the document does not hold, without holding it', async () => {
    await open('con', 3)

    expect(editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })).toBe(true)
    await flush()

    expect(rowTexts()).toContain('const answer')
    expect(editor.materializeFullText()).toBe('con')
  })

  // Drawn into an element of its own is the whole of what makes a suggestion legible: painted into
  // the row's own text it is byte-identical to what the reader wrote, and there is nothing on screen
  // saying which half is theirs.
  it('boxes what it draws so it can be told apart from the text the reader typed', async () => {
    await open('con', 3)

    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    await flush()

    const boxed = container.querySelector('.editor-ghost-text')
    expect(boxed?.textContent).toBe('st answer')
    expect(boxed?.parentElement?.textContent).toBe('const answer')
  })

  it('draws a suggestion offered where a hidden marker begins', async () => {
    await open('**bold** tail', 0)
    editor.setInlineReplacementProvider(() => [
      { id: 'close', startIndex: 6, endIndex: 8, text: '' },
    ])
    await flush()

    expect(editor.setInlineSuggestion({ from: 0, to: 6, text: '**boldSUGGEST' })).toBe(true)
    await flush()

    expect(rowTexts()).toContain('**boldSUGGEST tail')
  })

  it('writes exactly what was drawn when Tab takes it', async () => {
    await open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    await flush()

    pressTab()
    await flush()

    expect(editor.materializeFullText()).toBe('const answer')
    expect(rowTexts()).toEqual(['const answer'])
  })

  it('takes a suggestion ahead of the snippet the caret is standing in', async () => {
    await open('', 0)
    insertSnippet('log($1, ${2:level})')
    editor.setInlineSuggestion({ from: 4, to: 4, text: 'answer' })
    await flush()

    pressTab()
    await flush()

    expect(editor.materializeFullText()).toBe('log(answer, level)')

    // The stops are still there to cycle: a suggestion taken inside a snippet is text typed into the
    // stop, not the reader walking out of it.
    pressTab()
    await flush()

    expect(selectedText()).toBe('level')
  })

  // A suggestion is reduced to what the document does not already say, so one taken inside a
  // placeholder lands as an edit against the end of that placeholder rather than as the whole of
  // it. Written straight through, it falls outside the stop it filled in and every keystroke after
  // it is refused as an edit somewhere else in the document.
  it('carries a suggestion taken inside a stop into the copies of that stop', async () => {
    await open('', 0)
    insertSnippet('${1:x} = new ${1:x}()')
    type('b')

    expect(editor.materializeFullText()).toBe('b = new b()')

    editor.setInlineSuggestion({ from: 0, to: 1, text: 'bar' })
    await flush()

    pressTab()
    await flush()

    expect(editor.materializeFullText()).toBe('bar = new bar()')

    type('z')

    expect(editor.materializeFullText()).toBe('barz = new barz()')
  })

  it('indents when nothing is on offer', async () => {
    await open('con', 3)

    pressTab()
    await flush()

    expect(editor.materializeFullText()).toMatch(/^con[ \t]+$/)
  })

  it('leaves a suggestion alone for shift+Tab, which has nothing to walk back through', async () => {
    await open('  con', 5)
    editor.setInlineSuggestion({ from: 0, to: 5, text: '  const answer' })
    await flush()

    pressTab({ shift: true })
    await flush()

    expect(editor.materializeFullText()).toBe('con')
  })

  it('takes one word at a time and keeps offering the rest', async () => {
    await open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer = 42' })
    await flush()

    expect(editor.dispatchCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(true)
    await flush()

    expect(editor.materializeFullText()).toBe('const ')
    expect(rowTexts()).toContain('const answer = 42')

    expect(editor.dispatchCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(true)
    await flush()

    expect(editor.materializeFullText()).toBe('const answer ')
    expect(rowTexts()).toContain('const answer = 42')

    expect(editor.dispatchCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(true)
    expect(editor.dispatchCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(true)
    await flush()

    // The last word leaves nothing to re-derive, so the suggestion falls quiet on its own.
    expect(editor.materializeFullText()).toBe('const answer = 42')
    expect(editor.dispatchCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(false)
    expect(rowTexts()).toEqual(['const answer = 42'])
  })

  it('takes a suggestion down once the document has moved under it', async () => {
    await open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    await flush()

    type('x')
    await flush()

    expect(rowTexts()).toEqual(['conx'])

    // Not merely unpainted: a suggestion worked out against text that has since changed is not
    // something Tab may still write into the document.
    pressTab()
    await flush()

    expect(editor.materializeFullText()).toMatch(/^conx[ \t]+$/)
  })

  // Every run was placed against where the caret stood, and the one thing the runs may never be is
  // behind it. Moving the caret is also the reader saying they are doing something else, so Tab has
  // to be the indent key again rather than a commit at an offset they have left.
  it('takes a suggestion down once the caret has moved out from under it', async () => {
    await open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    await flush()

    expect(rowTexts()).toContain('const answer')

    pressKey('ArrowLeft')
    await flush()

    expect(rowTexts()).toEqual(['con'])

    pressTab()
    await flush()

    expect(editor.materializeFullText()).toMatch(/^co[ \t]+n$/)
  })

  it('offers nothing over a selection, where there is no one place it would be typed', async () => {
    await open('con', 3)
    editor.setSelection(0, 3)

    expect(editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })).toBe(false)
    await flush()

    expect(rowTexts()).toEqual(['con'])
  })

  it('offers nothing to a reader who cannot write to the document', async () => {
    await open('con', 3)
    editor.setEditability('readonly')

    expect(editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })).toBe(false)
    await flush()

    expect(rowTexts()).toEqual(['con'])
  })

  it('reaches the commands from a host that dispatches them', async () => {
    await open('con', 3)

    expect(editor.dispatchCommand('editor.action.inlineSuggest.commit')).toBe(false)

    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })

    expect(editor.dispatchCommand('editor.action.inlineSuggest.commit')).toBe(true)
    expect(editor.materializeFullText()).toBe('const answer')
  })

  it('keeps the family classified so a host can bind or withhold it as one', () => {
    expect(editorCommandPackForCommand('editor.action.inlineSuggest.commit')).toBe('inline-suggest')
    expect(editorCommandPackForCommand('editor.action.inlineSuggest.acceptNextWord')).toBe(
      'inline-suggest',
    )

    const hostBinding = {
      chord: [{ key: 'ArrowRight', mod: true, shift: true }],
      command: 'editor.action.inlineSuggest.commit',
    } as const
    expect(editorKeymapLayersForBindings([hostBinding], ['inline-suggest'])).toHaveLength(1)
    expect(editorKeymapLayersForBindings([hostBinding], ['text-editing'])).toHaveLength(0)
  })

  it('takes the only arrow chord that is free, and only where it is free', () => {
    const commands = (platform: 'mac' | 'windows' | 'linux') =>
      defaultEditorKeyBindings(platform).map((binding) => binding.command)

    expect(commands('mac')).toContain('editor.action.inlineSuggest.acceptNextWord')
    for (const platform of ['windows', 'linux'] as const) {
      expect(commands(platform)).not.toContain('editor.action.inlineSuggest.acceptNextWord')
      // The chord that would carry it there is subword motion, and a reader who never sees a
      // suggestion would simply have lost it.
      expect(commands(platform)).toContain('cursorWordPartRight')
    }

    for (const platform of ['mac', 'windows', 'linux'] as const) {
      // Tab stays where it was: the whole suggestion is taken through the key that already indents,
      // which is the only way that key can still indent when nothing is on offer.
      // The completion list's accept outranks it only while a list is open.
      const tab = defaultEditorKeyBindings(platform).find(
        ({ chord: [hotkey], when }) =>
          typeof hotkey !== 'string' &&
          hotkey.key === 'Tab' &&
          !hotkey.shift &&
          !when?.includes('suggestWidgetVisible'),
      )
      expect(tab?.command).toBe('indentSelection')
    }
  })

  async function open(text: string, caret: number): Promise<void> {
    editor.openDocument({ documentId: 'main.ts', languageId: 'typescript', text })
    editor.setSelection(caret, caret)
    await flush()
  }

  /** Expands a snippet at the caret and starts its stops, which is all a completion source does. */
  function insertSnippet(source: string): void {
    const contributed = edits
    if (!contributed?.startSnippetSession) throw new Error('the host offered no snippet session')

    const parsed = parseSnippet(source)
    const selection = snippetInitialSelection(parsed, 0)
    contributed.applyEdits([{ from: 0, text: parsed.text, to: 0 }], 'test.snippet', {
      anchor: selection.start,
      head: selection.end,
    })
    // The caret visits the occurrence it can type into; every other occurrence of the same stop
    // rides along as a copy of it, which is what a completion source hands over.
    contributed.startSnippetSession(
      parsed.stops.flatMap((stop) => {
        const caret = stop.ranges.findIndex((range) => !range.transform)
        const range = stop.ranges[caret]
        if (!range) return []

        const mirrors = stop.ranges.filter((_value, index) => index !== caret)
        const { end, start } = range
        return [mirrors.length > 0 ? { end, mirrors, start } : { end, start }]
      }),
    )
  }

  function pressTab(modifiers: { readonly shift?: boolean } = {}): void {
    pressKey('Tab', modifiers)
  }

  function pressKey(key: string, modifiers: { readonly shift?: boolean } = {}): void {
    document.querySelector('.editor-virtualized')?.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey: modifiers.shift === true,
      }),
    )
  }

  function type(text: string): void {
    // The scroll element is where the input handlers are bound. It is private on Editor and no
    // testing seam exposes it, and its class is shared with every other virtualized view a host may
    // mount, so a DOM query could answer with the wrong one.
    editorElement(editor).dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      }),
    )
  }

  function rowTexts(): readonly (string | null)[] {
    return [...container.querySelectorAll('.editor-virtualized-row')].map((row) => row.textContent)
  }

  /** The text the last keystroke left selected. */
  function selectedText(): string {
    const change = lastChange
    const selection = change?.selections.selections[0]
    if (!change || !selection) throw new Error('the keystroke left no selection')

    const resolved = resolveSelection(change.snapshot, selection)
    return editor.materializeFullText().slice(resolved.startOffset, resolved.endOffset)
  }
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 180))
  await Promise.resolve()
  await Promise.resolve()
}
