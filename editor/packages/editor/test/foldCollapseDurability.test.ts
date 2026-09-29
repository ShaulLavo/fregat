import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'
import type { Editor } from '../src/editor'
import { createVisibleEditor } from './factories/visibleEditor'
import type { EditorPlugin } from '../src/plugins'
import {
  createEmptySyntaxResult,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
} from '../src/public/syntax'
import {
  resetEditorInstanceCount,
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
} from '../src/public/testing'
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

const TEXT = 'a\nb\nif (x) {\n  y();\n}\nz();'
const BLOCK_START = TEXT.indexOf('{')
const BLOCK_END = TEXT.indexOf('\nz();')
const HEADER_END = TEXT.indexOf('\n  y();')
const BLOCK_START_ROW = 2
const BLOCK_END_ROW = 4

const highlightsMap = new Map<string, Highlight>()
const mockRegistry = {
  set: (name: string, highlight: Highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name: string) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {}

type FoldDelivery = {
  readonly foldingSupport?: EditorSyntaxSession['foldingSupport']
  folds: readonly FoldRange[]
}

function blockFold(offsetShift: number): FoldRange {
  return {
    startIndex: BLOCK_START + offsetShift,
    endIndex: BLOCK_END + offsetShift,
    startLine: BLOCK_START_ROW,
    endLine: BLOCK_END_ROW,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

function indentFold(offsetShift: number): FoldRange {
  return {
    startIndex: HEADER_END + offsetShift,
    endIndex: BLOCK_END + offsetShift,
    startLine: BLOCK_START_ROW,
    endLine: BLOCK_END_ROW,
    type: 'indent',
    languageId: 'typescript',
  }
}

function headerOnlyFold(): FoldRange {
  return {
    startIndex: HEADER_END,
    endIndex: TEXT.indexOf('\n}'),
    startLine: BLOCK_START_ROW,
    endLine: BLOCK_START_ROW + 1,
    type: 'indent',
    languageId: 'typescript',
  }
}

const SIBLING_BLOCKS = 'if (a) {\n  one();\n}\nwhile (b) {\n  two();\n  three();\n}'
const NESTED_ON_ONE_ROW = 'top\nif (x) {\n  inner();\n} // end\nafter'

function siblingFirstBlock(): FoldRange {
  return {
    startIndex: SIBLING_BLOCKS.indexOf('{'),
    endIndex: SIBLING_BLOCKS.indexOf('\nwhile'),
    startLine: 0,
    endLine: 2,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

function siblingSecondBlock(): FoldRange {
  return {
    startIndex: SIBLING_BLOCKS.indexOf('{', SIBLING_BLOCKS.indexOf('while')),
    endIndex: SIBLING_BLOCKS.length,
    startLine: 3,
    endLine: 6,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

function siblingSecondBlockAfterDeletion(): FoldRange {
  const shift = SIBLING_BLOCKS.indexOf('while')
  return {
    startIndex: siblingSecondBlock().startIndex - shift,
    endIndex: siblingSecondBlock().endIndex - shift,
    startLine: 0,
    endLine: 3,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

function nestedBraceFold(offsetShift: number): FoldRange {
  return {
    startIndex: NESTED_ON_ONE_ROW.indexOf('{') + offsetShift,
    endIndex: NESTED_ON_ONE_ROW.indexOf('\nafter') + offsetShift,
    startLine: 1,
    endLine: 3,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

function nestedIndentFold(offsetShift: number): FoldRange {
  return {
    startIndex: NESTED_ON_ONE_ROW.indexOf('\n  inner') + offsetShift,
    endIndex: NESTED_ON_ONE_ROW.indexOf('\n} // end') + offsetShift,
    startLine: 1,
    endLine: 2,
    type: 'indent',
    languageId: 'typescript',
  }
}

function pressEnter(): void {
  editorRoot().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertLineBreak',
    }),
  )
}

/**
 * The rows the view is actually drawing, which is the only reading of "what is hidden" that a
 * recycled row element cannot lie about: a row that scrolls out of the pool keeps its old text.
 */
function createRowRecorderPlugin(rows: { latest: readonly string[] }): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          // Nothing of the view is held onto, so there is nothing to release.
          dispose: () => undefined,
          update: (snapshot) => {
            rows.latest = snapshot.visibleRows
              .filter((row) => row.kind === 'text')
              .map((row) => row.text.slice(0, row.text.length))
          },
        }),
      }),
  }
}

function createFoldSyntaxSession(delivery: FoldDelivery): EditorSyntaxSession {
  const result = (): EditorSyntaxResult => ({
    ...createEmptySyntaxResult(),
    folds: delivery.folds,
    tokens: [],
  })

  return {
    refresh: async () => result(),
    applyChange: async () => result(),
    getResult: () => result(),
    getTokens: () => [],
    foldingSupport: delivery.foldingSupport ?? 'supported',
    getSnapshotVersion: () => 0,
    dispose: () => undefined,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushSyntaxDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 160))
  await flushMicrotasks()
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function foldToggle(): HTMLButtonElement {
  return document.querySelector(
    '.editor-virtualized-fold-toggle:not([hidden])',
  ) as HTMLButtonElement
}

function foldState(): string | undefined {
  return foldToggle().dataset.editorFoldState
}

function clickFoldToggle(): void {
  foldToggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function typeCharacter(data: string): void {
  editorRoot().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data,
      inputType: 'insertText',
    }),
  )
}

describe('fold collapse durability', () => {
  let container: HTMLElement
  let editor: Editor
  const rows: { latest: readonly string[] } = { latest: [] }

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — polyfilling Highlight constructor for tests
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    rows.latest = []
    editor = createVisibleEditor(container, {
      plugins: [lineGutterPlugin(), foldGutterPlugin(), createRowRecorderPlugin(rows)],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
  })

  async function openWithFold(delivery: FoldDelivery, text = TEXT): Promise<void> {
    setEditorSyntaxSessionFactory(() => createFoldSyntaxSession(delivery))
    editor.openDocument({
      documentId: 'main.ts',
      languageId: 'typescript',
      text,
    })
    await flushMicrotasks()
  }

  it('keeps a collapsed block folded when a keystroke above it shifts the reparsed offsets', async () => {
    const delivery: FoldDelivery = { folds: [blockFold(0)] }
    await openWithFold(delivery)

    expect(foldState()).toBe('expanded')
    clickFoldToggle()
    expect(foldState()).toBe('collapsed')
    expect(editorRoot().textContent).not.toContain('  y();')

    delivery.folds = [blockFold(1)]
    editor.dispatchCommand('cursorDocumentStart')
    typeCharacter('x')
    await flushSyntaxDebounce()

    expect(editor.materializeFullText().startsWith('x')).toBe(true)
    expect(foldState()).toBe('collapsed')
    expect(editorRoot().textContent).not.toContain('  y();')
  })

  it('keeps a collapsed block hiding its own rows while same-row typing outruns the parse', async () => {
    await openWithFold({ folds: [blockFold(0)] })

    clickFoldToggle()
    expect(editorRoot().textContent).toContain('if (x) {')
    expect(editorRoot().textContent).not.toContain('  y();')

    editor.dispatchCommand('cursorDocumentStart')
    for (const character of 'xxxxxxxx') typeCharacter(character)

    expect(editorRoot().textContent).toContain('if (x) {')
    expect(editorRoot().textContent).not.toContain('  y();')
  })

  it('keeps a collapsed region folded when a later parse names the same rows differently', async () => {
    await openWithFold({ folds: [blockFold(0)] })

    clickFoldToggle()
    expect(foldState()).toBe('collapsed')

    editor.setSyntaxFolds([indentFold(0)])

    expect(foldState()).toBe('collapsed')
    expect(editorRoot().textContent).not.toContain('  y();')
  })

  it('keeps a collapsed region folded when a grammar restates it to a different end row', async () => {
    // Indentation stops at the last indented row; a grammar carries on to the
    // closing delimiter. Same region, and the collapse belongs to the region.
    const delivery: FoldDelivery = { folds: [headerOnlyFold()] }
    await openWithFold(delivery)

    clickFoldToggle()
    expect(foldState()).toBe('collapsed')

    delivery.folds = [blockFold(0)]
    editor.setSyntaxFolds(delivery.folds)
    await flushMicrotasks()

    expect(foldState()).toBe('collapsed')
  })

  it('does not hand the collapse of a deleted block to the block that took its place', async () => {
    const delivery: FoldDelivery = { folds: [siblingFirstBlock(), siblingSecondBlock()] }
    await openWithFold(delivery, SIBLING_BLOCKS)

    editor.setSelection(0)
    editor.dispatchCommand('editor.fold')
    expect(rows.latest).toEqual(['if (a) {', 'while (b) {', '  two();', '  three();', '}'])

    delivery.folds = [siblingSecondBlockAfterDeletion()]
    editor.setSelection(0, SIBLING_BLOCKS.indexOf('while'))
    editor.dispatchCommand('deleteBackward')
    await flushSyntaxDebounce()

    expect(editor.materializeFullText().startsWith('while (b) {')).toBe(true)
    expect(foldState()).toBe('expanded')
    expect(rows.latest).toEqual(['while (b) {', '  two();', '  three();', '}'])
  })

  it.each(['single', 'batch'] as const)(
    'preserves syntax and manual collapses when a %s edit deletes an earlier block',
    async (kind) => {
      const text = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl'
      await openWithFold(
        {
          folds: [
            {
              startIndex: 1,
              endIndex: 9,
              startLine: 0,
              endLine: 4,
              type: 'statement_block',
              languageId: 'typescript',
            },
            {
              startIndex: 11,
              endIndex: 13,
              startLine: 5,
              endLine: 6,
              type: 'statement_block',
              languageId: 'typescript',
            },
          ],
        },
        text,
      )
      editor.setSelection(16, 19)
      expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(true)
      expect(editor.fold(10)).toBe(true)
      expect(rows.latest).not.toContain('g')
      expect(rows.latest).not.toContain('j')

      const edits = [{ from: 0, to: 10, text: '' }]
      if (kind === 'batch') edits.push({ from: text.length, to: text.length, text: '!' })
      editor.edit(edits)

      expect(editor.getState().cursor.row).toBe(3)
      expect(rows.latest).toEqual(['f', 'h', 'i', 'k', kind === 'batch' ? 'l!' : 'l'])
    },
  )

  it('keeps a collapsed block folded when Enter above its opening brace moves it down a row', async () => {
    const delivery: FoldDelivery = { folds: [blockFold(0)] }
    await openWithFold(delivery)

    clickFoldToggle()
    expect(foldState()).toBe('collapsed')

    delivery.folds = [{ ...blockFold(1), startLine: 3, endLine: 5 }]
    editor.setSelection(BLOCK_START)
    pressEnter()
    await flushSyntaxDebounce()

    expect(editor.materializeFullText()).toContain('if (x) \n{')
    expect(foldState()).toBe('collapsed')
    expect(rows.latest).toEqual(['a', 'b', 'if (x) ', '{', 'z();'])
  })

  it('leaves the wider region of a shared header row expanded when the narrower one is collapsed', async () => {
    const delivery: FoldDelivery = { folds: [nestedBraceFold(0), nestedIndentFold(0)] }
    await openWithFold(delivery, NESTED_ON_ONE_ROW)

    editor.setSelection(NESTED_ON_ONE_ROW.indexOf('if'))
    editor.dispatchCommand('editor.fold')
    expect(rows.latest).toEqual(['top', 'if (x) {', '} // end', 'after'])

    delivery.folds = [nestedBraceFold(1), nestedIndentFold(1)]
    editor.dispatchCommand('cursorDocumentStart')
    typeCharacter('q')
    await flushSyntaxDebounce()

    expect(rows.latest).toEqual(['qtop', 'if (x) {', '} // end', 'after'])
  })

  it('does not spring a region the user opened shut again when both share a header row', async () => {
    const delivery: FoldDelivery = { folds: [nestedBraceFold(0), nestedIndentFold(0)] }
    await openWithFold(delivery, NESTED_ON_ONE_ROW)

    editor.setSelection(NESTED_ON_ONE_ROW.indexOf('if'))
    editor.dispatchCommand('editor.fold')
    editor.dispatchCommand('editor.fold')
    expect(rows.latest).toEqual(['top', 'if (x) {', 'after'])

    // A parse that only names the braces, so the row now offers one range for two collapses.
    editor.setSyntaxFolds([nestedBraceFold(0)])
    clickFoldToggle()
    expect(rows.latest).toEqual(['top', 'if (x) {', '  inner();', '} // end', 'after'])

    editor.setSyntaxFolds([nestedBraceFold(0), nestedIndentFold(0)])

    expect(rows.latest).toEqual(['top', 'if (x) {', '} // end', 'after'])
  })

  it('does not re-collapse a region the user opened when the extent is restated', async () => {
    const delivery: FoldDelivery = { folds: [headerOnlyFold()] }
    await openWithFold(delivery)

    clickFoldToggle()
    clickFoldToggle()
    expect(foldState()).toBe('expanded')

    delivery.folds = [blockFold(0)]
    editor.setSyntaxFolds(delivery.folds)
    await flushMicrotasks()

    expect(foldState()).toBe('expanded')
  })

  it('keeps folding a language whose grammar describes no folds at all', async () => {
    // The grammar parses and settles, but fold queries ship per language: this
    // one was never asked. Reading that as "answered none" is what left css,
    // html and json with no folds at all.
    const delivery: FoldDelivery = { folds: [], foldingSupport: 'unsupported' }
    await openWithFold(delivery)
    await flushSyntaxDebounce()

    expect(foldToggle()).toBeTruthy()
    clickFoldToggle()
    expect(foldState()).toBe('collapsed')
  })
})
