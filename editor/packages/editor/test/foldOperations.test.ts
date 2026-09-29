import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'
import type { Editor } from '../src/editor'
import { createVisibleEditor } from './factories/visibleEditor'
import type { EditorLogEvent, EditorPlugin } from '../src/plugins'
import { resetEditorInstanceCount, setHighlightRegistry } from '../src/public/testing'
import type { FoldRange } from '../src/syntax'

/**
 * The gutter package types itself against the published `@singapore-editor/core` facade, so the plugin
 * objects its own `create*Plugin` helpers build carry dist's `EditorPlugin` — a nominally different
 * type from the src one this Editor takes. The contributions are plain structural types that do
 * cross that line, so they are registered here through the same one-line wrapper the package uses.
 */
function lineGutterPlugin(): EditorPlugin {
  const contribution = createLineGutterContribution()
  return {
    name: 'line-gutter',
    activate: (context) => context.registerGutterContribution(contribution),
  }
}

function foldGutterPlugin(): EditorPlugin {
  const contribution = createFoldGutterContribution()
  return {
    name: 'fold-gutter',
    activate: (context) => context.registerGutterContribution(contribution),
  }
}

/**
 * Two top-level blocks, one of them nested, then flat rows no provider describes — room for a region
 * drawn by hand — and a last block for a drawn region to collide with.
 */
const LINES = [
  'function outer() {',
  '  if (a) {',
  '    inner()',
  '  }',
  '  tail()',
  '}',
  'function next() {',
  '  more()',
  '}',
  'header one',
  'body one',
  'body two',
  'header two',
  'body three',
  'body four',
  'function last() {',
  '  provided one',
  '  provided two',
  '}',
  'done()',
]
const TEXT = LINES.join('\n')

const OUTER_ROWS = [0, 5] as const
const INNER_ROWS = [1, 3] as const
const NEXT_ROWS = [6, 8] as const
const LAST_ROWS = [15, 18] as const

const highlightsMap = new Map<string, Highlight>()
const mockRegistry = {
  set: (name: string, highlight: Highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name: string) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {}

function rowStart(row: number): number {
  let offset = 0
  for (let index = 0; index < row; index += 1) offset += LINES[index]!.length + 1

  return offset
}

function rowEnd(row: number): number {
  return rowStart(row) + LINES[row]!.length
}

/** Both ends sit at the end of a row, which is where a provider puts them. */
function blockFold([startRow, endRow]: readonly [number, number]): FoldRange {
  return {
    startIndex: rowEnd(startRow),
    endIndex: rowEnd(endRow),
    startLine: startRow,
    endLine: endRow,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

const PROVIDED_FOLDS: readonly FoldRange[] = [
  blockFold(OUTER_ROWS),
  blockFold(INNER_ROWS),
  blockFold(NEXT_ROWS),
  blockFold(LAST_ROWS),
]

function logCollectorPlugin(events: EditorLogEvent[]): EditorPlugin {
  return {
    name: 'test.fold-command-log',
    activate: (context) =>
      context.registerLogger((event) => {
        events.push(event)
      }) ?? [],
  }
}

/** Mounted rows only: a retired row stays in the DOM still showing whatever it last rendered. */
function visibleText(): string {
  return [...document.querySelectorAll('.editor-virtualized-row:not([hidden])')]
    .map((row) => row.textContent ?? '')
    .join('\n')
}

function foldKeys(): readonly string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.editor-virtualized-fold-toggle:not([hidden])',
    ),
  ].map((toggle) => toggle.dataset.editorFoldKey ?? '')
}

/** The gutter keys of the drawn regions, which are typed apart from the described ones. */
function manualFoldKeys(): readonly string[] {
  return foldKeys().filter((key) => key.includes(':manual:'))
}

describe('fold operations', () => {
  let container: HTMLElement
  let editor: Editor
  let logEvents: EditorLogEvent[]

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — polyfilling Highlight constructor for tests
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    logEvents = []
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {
      plugins: [lineGutterPlugin(), foldGutterPlugin(), logCollectorPlugin(logEvents)],
    })
    editor.openDocument({ documentId: 'main.ts', languageId: 'typescript', text: TEXT })
    editor.setSyntaxFolds(PROVIDED_FOLDS)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
  })

  function foldCommandCounts(): readonly number[] {
    return logEvents
      .filter((event) => event.action === 'editor.fold.command')
      .map((event) => (event.fold as { readonly foldCount: number }).foldCount)
  }

  function drawRegion(startRow: number, endRow: number): boolean {
    editor.setSelection(rowStart(startRow), rowEnd(endRow))
    return editor.dispatchCommand('editor.createFoldingRangeFromSelection')
  }

  it('folds the caret region and its descendants, and nothing beside them', () => {
    editor.setSelection(rowStart(0))

    expect(editor.dispatchCommand('editor.foldRecursively')).toBe(true)
    expect(visibleText()).not.toContain('  tail()')
    expect(visibleText()).not.toContain('    inner()')
    // The block after this one is no descendant of it, so the recursion never reached its rows.
    expect(visibleText()).toContain('  more()')
    expect(visibleText()).toContain('  provided one')
  })

  it('unfolds the caret region and its descendants, and nothing beside them', () => {
    expect(editor.dispatchCommand('editor.foldAll')).toBe(true)
    editor.setSelection(rowStart(0))

    expect(editor.dispatchCommand('editor.unfoldRecursively')).toBe(true)
    expect(visibleText()).toContain('  tail()')
    expect(visibleText()).toContain('    inner()')
    expect(visibleText()).not.toContain('  more()')
    expect(visibleText()).not.toContain('  provided one')
  })

  it('refuses a drawn region that half-overlaps a described one', () => {
    // Rows 13-16 take in the head of the last block without reaching its end: nothing can hold both
    // that region and this one, so the drawn one is the one that gives way.
    expect(drawRegion(13, 16)).toBe(false)
    expect(manualFoldKeys()).toEqual([])
    expect(visibleText()).toContain('body four')
    expect(visibleText()).toContain('  provided one')
  })

  it('refuses a drawn region on the rows a described one already covers', () => {
    expect(drawRegion(...NEXT_ROWS)).toBe(false)
    expect(manualFoldKeys()).toEqual([])
    // A second region on those rows would have collapsed them, and put a second control on row 6.
    expect(visibleText()).toContain('  more()')
  })

  it('removes only the drawn regions the selection reaches', () => {
    expect(drawRegion(9, 11)).toBe(true)
    expect(drawRegion(12, 14)).toBe(true)
    expect(manualFoldKeys()).toHaveLength(2)
    expect(visibleText()).not.toContain('body one')
    expect(visibleText()).not.toContain('body three')

    editor.setSelection(rowStart(9))
    expect(editor.dispatchCommand('editor.removeManualFoldingRanges')).toBe(true)
    expect(manualFoldKeys()).toHaveLength(1)
    expect(visibleText()).toContain('body one')
    expect(visibleText()).not.toContain('body three')
  })

  it('drops a drawn region when a deletion runs up to the row it ends on', () => {
    expect(drawRegion(9, 11)).toBe(true)
    expect(editor.dispatchCommand('editor.unfold')).toBe(true)

    // The deletion stops exactly where the region does, so both of its edges move at once. Nothing
    // restates a hand-drawn region, so a region kept here would keep the extent it was drawn with.
    editor.setSelection(rowEnd(9), rowEnd(11))
    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toContain('header one\nheader two')
    expect(manualFoldKeys()).toEqual([])
    expect(editor.fold(rowStart(9))).toBe(false)
    expect(visibleText()).toContain('header two')
  })

  it('drops a drawn region when a deletion runs over the row it starts on', () => {
    expect(drawRegion(9, 11)).toBe(true)
    expect(editor.dispatchCommand('editor.unfold')).toBe(true)

    editor.setSelection(rowEnd(8), rowEnd(10))
    editor.dispatchCommand('deleteBackward')

    expect(editor.materializeFullText()).toContain('}\nbody two')
    // Row 9 is another region's text now, and a control there would head rows nobody drew over.
    expect(manualFoldKeys()).toEqual([])
    expect(editor.fold(rowStart(9))).toBe(false)
  })

  it('leaves a region already collapsed out of the work it reports doing', () => {
    editor.setSelection(rowStart(2))
    expect(editor.dispatchCommand('editor.fold')).toBe(true)
    editor.setSelection(rowStart(0))

    expect(editor.dispatchCommand('editor.foldRecursively')).toBe(true)
    // The inner region was collapsed before the recursion ran, so only the outer one changed.
    expect(foldCommandCounts()).toEqual([1, 1])
  })

  it('counts a region once when several carets sit inside it', () => {
    editor.setSelection(rowStart(2))
    expect(editor.dispatchCommand('editor.action.insertCursorBelow')).toBe(true)

    expect(editor.dispatchCommand('editor.fold')).toBe(true)
    expect(visibleText()).not.toContain('    inner()')
    expect(foldCommandCounts()).toEqual([1])
  })
})
