import type { EditorEditContributionContext } from '@singapore-editor/core/extensions'
import type { SelectionAffinity } from '@singapore-editor/core/document'
import { describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  completionApplication,
  completionNeedsResolve,
  completionPrefix,
  rankCompletionItems,
  completionTriggerFromChange,
  createCompletionEditFeature,
  createCompletionWidgetController,
} from '../src/completion'
import { createTestEditContributionContext } from '@singapore-editor/core/testing'
import { textDocument } from './snapshotDocument'

describe('completion helpers', () => {
  it('detects identifier and trigger-character completion changes', () => {
    expect(completionTriggerFromChange(editChange('v'))).toEqual({ triggerKind: 1 })
    expect(completionTriggerFromChange(editChange('.'))).toEqual({
      triggerKind: 2,
      triggerCharacter: '.',
    })
  })

  // A quote the editor closes as it is typed reaches the document as one two-character edit, and
  // the caret between the halves is where a module path is completed from.
  it('detects a trigger character that arrived with its own closer', () => {
    expect(completionTriggerFromChange(editChange('""'))).toEqual({
      triggerKind: 2,
      triggerCharacter: '"',
    })
    expect(completionTriggerFromChange(editChange('vv'))).toBeNull()
    expect(completionTriggerFromChange(editChange('value'))).toBeNull()
  })

  it('applies completion edits with a configured timing name', () => {
    const context = editContext()
    const feature = createCompletionEditFeature(context, 'testLsp.completion.accept')

    expect(
      feature.applyCompletion({
        edits: [{ from: 0, to: 1, text: 'value' }],
        selection: { anchor: 5, head: 5, affinity: 'before' },
      }),
    ).toBe(true)
    expect(context.applyEdits).toHaveBeenCalledWith(
      [{ from: 0, to: 1, text: 'value' }],
      'testLsp.completion.accept',
      { anchor: 5, head: 5, affinity: 'before' },
    )
  })

  it('creates completion applications from LSP primary and additional edits', () => {
    const application = completionApplication(atCaret('const va = helper', 8), {
      label: 'value',
      textEdit: {
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 8 },
        },
        newText: 'value',
      },
      additionalTextEdits: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'import { value } from "module";\n',
        },
      ],
    })

    expect(application).toEqual({
      edits: [
        { from: 6, to: 8, text: 'value' },
        { from: 0, to: 0, text: 'import { value } from "module";\n' },
      ],
      selection: { anchor: 43, head: 43, affinity: 'after' },
    })
  })

  it('uses a configured widget class namespace for styling and selection targets', () => {
    const themeSource = document.createElement('div')
    const onSelect = vi.fn()
    const controller = createCompletionWidgetController({
      document,
      themeSource,
      classNamespace: 'test-lsp',
      onSelect,
    })

    controller.show({
      anchor: new DOMRect(10, 20, 1, 16),
      items: [{ label: 'value', kind: 6 }],
    })

    const element = document.querySelector<HTMLElement>('.editor-test-lsp-completion')
    const row = document.querySelector<HTMLElement>('.editor-test-lsp-completion-item')
    expect(element?.hidden).toBe(false)
    expect(row?.textContent).toContain('value')

    row?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(onSelect).toHaveBeenCalledWith(0)
    expect(controller.containsTarget(row)).toBe(true)

    controller.dispose()
  })
})

function editContext(): EditorEditContributionContext {
  return createTestEditContributionContext({
    materializeFullText: () => '',
    applyEdits: vi.fn(),
    registerFeature: vi.fn(() => ({ dispose: vi.fn() })),
  })
}

function editChange(text: string): Parameters<typeof completionTriggerFromChange>[0] {
  return {
    kind: 'edit',
    edits: [{ from: 0, to: 0, text }],
  } as unknown as Parameters<typeof completionTriggerFromChange>[0]
}

describe('completionNeedsResolve', () => {
  const resolving = { completionProvider: { resolveProvider: true } }

  it('resolves an item whose edits the server deferred', () => {
    expect(completionNeedsResolve({ label: 'value' }, resolving)).toBe(true)
  })

  // The import edit is already in hand; a round-trip would only add latency.
  it('does not resolve an item that already carries its edits', () => {
    expect(completionNeedsResolve({ additionalTextEdits: [], label: 'value' }, resolving)).toBe(
      false,
    )
  })

  it('does not resolve when the server cannot', () => {
    expect(completionNeedsResolve({ label: 'value' }, { completionProvider: {} })).toBe(false)
    expect(completionNeedsResolve({ label: 'value' }, null)).toBe(false)
    expect(completionNeedsResolve({ label: 'value' }, undefined)).toBe(false)
  })
})

describe('snippet completions', () => {
  const snippetItem = (insertText: string) => ({
    insertText,
    insertTextFormat: 2 as const,
    label: 'fn',
  })

  it('expands a snippet and selects its first placeholder', () => {
    const application = completionApplication(
      atCaret('const x = f', 11, 'before'),
      snippetItem('fn(${1:arg})'),
    )

    expect(application?.edits).toEqual([{ from: 10, to: 11, text: 'fn(arg)' }])
    expect(application?.selection).toEqual({ anchor: 13, head: 16, affinity: 'before' })
  })

  it('puts the caret at an empty tab stop', () => {
    const application = completionApplication(atCaret('f', 1), snippetItem('fn($1)'))

    expect(application?.edits[0]?.text).toBe('fn()')
    expect(application?.selection).toEqual({ anchor: 3, head: 3, affinity: 'after' })
  })

  // Without a stop there is nothing to select, so it behaves like a plain completion.
  it('falls back to the end of the insertion when a snippet has no stops', () => {
    const application = completionApplication(atCaret('f', 1), snippetItem('fn()'))

    expect(application?.selection).toEqual({ anchor: 4, head: 4, affinity: 'after' })
  })

  it('leaves a non-snippet completion alone', () => {
    const application = completionApplication(atCaret('f', 1), {
      insertText: 'fn(${1:arg})',
      label: 'fn',
    })

    expect(application?.edits[0]?.text).toBe('fn(${1:arg})')
  })
})

describe('completion ranges', () => {
  const item = (textEdit: lsp.CompletionItem['textEdit']): lsp.CompletionItem => ({
    label: 'value',
    textEdit,
  })

  it('takes the replace range of an item that carries both', () => {
    const application = completionApplication(atCaret('const foobar', 9), {
      label: 'foobaz',
      textEdit: {
        insert: singleLineRange(6, 9),
        replace: singleLineRange(6, 12),
        newText: 'foobaz',
      },
    })

    expect(application?.edits).toEqual([{ from: 6, to: 12, text: 'foobaz' }])
  })

  it('grows the replacement over the characters typed since the request', () => {
    const application = completionApplication(
      { document: textDocument('const val'), offset: 9, caretOffset: 11, caretAffinity: 'after' },
      item({ range: singleLineRange(6, 9), newText: 'value' }),
    )

    expect(application?.edits).toEqual([{ from: 6, to: 11, text: 'value' }])
  })

  it('follows the caret back when characters are removed after the request', () => {
    const removed = (caretOffset: number) =>
      completionApplication(
        { document: textDocument('const val'), offset: 9, caretOffset, caretAffinity: 'after' },
        item({ range: singleLineRange(6, 9), newText: 'value' }),
      )?.edits

    expect(removed(8)).toEqual([{ from: 6, to: 8, text: 'value' }])
    // Deleting past the word start leaves nothing to replace rather than an inverted range.
    expect(removed(5)).toEqual([{ from: 6, to: 6, text: 'value' }])
  })

  it('moves an additional edit below the caret along with what was typed', () => {
    const application = completionApplication(
      {
        document: textDocument('const val\nend'),
        offset: 9,
        caretOffset: 10,
        caretAffinity: 'after',
      },
      {
        label: 'value',
        textEdit: { range: singleLineRange(6, 9), newText: 'value' },
        additionalTextEdits: [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            newText: '// note\n',
          },
        ],
      },
    )

    expect(application?.edits).toEqual([
      { from: 6, to: 10, text: 'value' },
      { from: 11, to: 11, text: '// note\n' },
    ])
  })

  // Both describe a document the request never asked about, so the typed characters cannot be
  // measured against them.
  it('rejects a range the caret was outside of', () => {
    expect(
      completionApplication(
        atCaret('const val', 9),
        item({ range: singleLineRange(0, 5), newText: 'value' }),
      ),
    ).toBeNull()
  })

  it('rejects a range spanning lines', () => {
    expect(
      completionApplication(atCaret('const val\nend', 9), {
        label: 'value',
        textEdit: {
          range: { start: { line: 0, character: 6 }, end: { line: 1, character: 1 } },
          newText: 'value',
        },
      }),
    ).toBeNull()
  })
})

function atCaret(
  text: string,
  offset: number,
  caretAffinity: SelectionAffinity = 'after',
): Parameters<typeof completionApplication>[0] {
  return { document: textDocument(text), offset, caretOffset: offset, caretAffinity }
}

function singleLineRange(start: number, end: number): lsp.Range {
  return { start: { line: 0, character: start }, end: { line: 0, character: end } }
}

describe('completionPrefix', () => {
  it('reads the identifier being typed', () => {
    expect(completionPrefix('const val', 9)).toBe('val')
  })

  it('is empty after a non-identifier character', () => {
    expect(completionPrefix('const ', 6)).toBe('')
  })
})

describe('rankCompletionItems', () => {
  const items = (...labels: readonly string[]) => labels.map((label) => ({ label }))

  it('keeps the list untouched with no prefix', () => {
    const list = items('b', 'a')

    expect(rankCompletionItems(list, '')).toBe(list)
  })

  it('drops items that do not match', () => {
    expect(rankCompletionItems(items('value', 'other'), 'val').map((i) => i.label)).toEqual([
      'value',
    ])
  })

  it('prefers an exact-case prefix over a case-insensitive one', () => {
    const ranked = rankCompletionItems(items('Value', 'value'), 'val')

    expect(ranked.map((item) => item.label)).toEqual(['value', 'Value'])
  })

  it('ranks a prefix above a subsequence', () => {
    // verticalAlign contains v-a-l in order; canVerifyLater does not, and is rightly excluded.
    const ranked = rankCompletionItems(items('verticalAlign', 'value'), 'val')

    expect(ranked.map((item) => item.label)).toEqual(['value', 'verticalAlign'])
  })

  // sortText is how a server expresses relevance the client cannot compute.
  it('falls back to the server order for equal matches', () => {
    const ranked = rankCompletionItems(
      [
        { label: 'valueB', sortText: '1' },
        { label: 'valueA', sortText: '0' },
      ],
      'value',
    )

    expect(ranked.map((item) => item.label)).toEqual(['valueA', 'valueB'])
  })

  it('matches on filterText when the server supplies one', () => {
    const ranked = rankCompletionItems([{ filterText: 'value', label: 'Different' }], 'val')

    expect(ranked.map((item) => item.label)).toEqual(['Different'])
  })

  // Two editors on a page filter their own lists, in whatever order their users type. A filter that
  // remembered one list at a time would hand each of them the other's work to do over again.
  it('narrows each list against its own last filter, not the last list it saw', () => {
    const scored: string[] = []
    const server = watchedItems(['value', 'valueOf', 'other'], scored)
    const elsewhere = watchedItems(['count'], scored)

    rankCompletionItems(server, 'val')
    rankCompletionItems(elsewhere, 'cou')
    scored.length = 0
    const ranked = rankCompletionItems(server, 'valu')

    expect(ranked.map((item) => item.label)).toEqual(['value', 'valueOf'])
    expect(scored).not.toContain('other')
  })

  // The runs mark a word that is no longer being typed: kept, they underline characters of the
  // labels for a filter the list is no longer under.
  it('takes the marked runs off a list it stops filtering', () => {
    const items = [{ label: 'value' }, { label: 'verticalAlign' }]
    rankCompletionItems(items, 'val')

    const runs = shownMatchRuns(rankCompletionItems(items, ''))

    expect(runs).toEqual([])
  })
})

function watchedItems(labels: readonly string[], scored: string[]): readonly lsp.CompletionItem[] {
  return labels.map((label) => ({
    label,
    get filterText() {
      scored.push(label)
      return label
    },
  }))
}

/** The runs the widget marks up when it is handed these items, and nothing left in the document. */
function shownMatchRuns(items: readonly lsp.CompletionItem[]): readonly string[] {
  const controller = createCompletionWidgetController({
    document,
    themeSource: document.createElement('div'),
    classNamespace: 'test-marks',
    onSelect: vi.fn(),
  })
  controller.show({ anchor: new DOMRect(10, 20, 1, 16), items })
  const runs = Array.from(
    document.querySelectorAll<HTMLElement>('.editor-test-marks-completion-match'),
    (element) => element.textContent ?? '',
  )
  controller.dispose()
  return runs
}
