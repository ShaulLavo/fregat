import { detectPlatform } from '@tanstack/hotkeys'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'
import type { Editor } from '../src/editor'
import { createVisibleEditor } from './factories/visibleEditor'
import { EDITOR_FOLD_LEVELS, type EditorCommandId } from '../src/editor/commands'
import { foldNesting, isEditorFoldCommand } from '../src/editor/foldOperations'
import {
  defaultEditorKeyBindings,
  defaultEditorKeymapLayers,
  editorCommandPackForCommand,
  filterEditorKeymapLayersByCommandPacks,
  readonlySafeEditorCommandPacks,
} from '../src/editor/keymap'
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

/**
 * Two top-level blocks, one of them nested, and a flat tail no provider describes — which is where a
 * region drawn by hand has room to be its own thing.
 */
const TREE_LINES = [
  'function outer() {',
  '  if (a) {',
  '    inner()',
  '  }',
  '  tail()',
  '}',
  'function next() {',
  '  more()',
  '}',
  'header',
  'data one',
  'data two',
  'done()',
]
const TREE_TEXT = TREE_LINES.join('\n')

const DEEP_LINES = EDITOR_FOLD_LEVELS.map((level) => `open${level} {`).concat(
  'leaf',
  [...EDITOR_FOLD_LEVELS].reverse().map((level) => `close${level} }`),
  'tail',
)
const DEEP_TEXT = DEEP_LINES.join('\n')

/** A second file, as long as the first and with nothing in it any provider or indentation folds. */
const PLAIN_LINES = TREE_LINES.map((_line, row) => `plain ${row}`)
const PLAIN_TEXT = PLAIN_LINES.join('\n')

/** One block whose closing row only the parse reaches: indentation stops at the row above it. */
const BRACE_LINES = ['function only() {', '  body()', '}', 'after()']
const BRACE_TEXT = BRACE_LINES.join('\n')

/**
 * Indentation reads rows 1–3 as one region under row 0, while the parse ends the block opened on
 * row 2 at the dedented `}` on row 4 — two descriptions of the document that cross each other.
 */
const CROSSING_LINES = ['head:', '  one', '  two {', '  three', '}']
const CROSSING_TEXT = CROSSING_LINES.join('\n')

const FOLD_COMMAND_IDS = [
  'editor.fold',
  'editor.unfold',
  'editor.foldRecursively',
  'editor.unfoldRecursively',
  'editor.foldAll',
  'editor.unfoldAll',
  'editor.createFoldingRangeFromSelection',
  'editor.removeManualFoldingRanges',
  ...EDITOR_FOLD_LEVELS.map((level) => `editor.foldLevel${level}` as const),
] as const satisfies readonly EditorCommandId[]

const highlightsMap = new Map<string, Highlight>()
const mockRegistry = {
  set: (name: string, highlight: Highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name: string) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {}

function rowStart(text: string, row: number): number {
  const lines = text.split('\n')
  let offset = 0
  for (let index = 0; index < row; index += 1) offset += lines[index]!.length + 1

  return offset
}

function rowEnd(text: string, row: number): number {
  return rowStart(text, row) + text.split('\n')[row]!.length
}

/** A block whose header row stays visible and whose remaining rows are the ones it hides. */
function blockFold(text: string, startRow: number, endRow: number): FoldRange {
  return {
    startIndex: rowEnd(text, startRow),
    endIndex: rowEnd(text, endRow),
    startLine: startRow,
    endLine: endRow,
    type: 'statement_block',
    languageId: 'typescript',
  }
}

const TREE_FOLDS: readonly FoldRange[] = [
  blockFold(TREE_TEXT, 0, 5),
  blockFold(TREE_TEXT, 1, 3),
  blockFold(TREE_TEXT, 6, 8),
]

const DEEP_FOLDS: readonly FoldRange[] = EDITOR_FOLD_LEVELS.map((level) =>
  blockFold(DEEP_TEXT, level - 1, DEEP_LINES.length - 1 - level),
)

function createFoldSyntaxSession(folds: readonly FoldRange[]): EditorSyntaxSession {
  const result = (): EditorSyntaxResult => ({
    ...createEmptySyntaxResult(),
    folds,
    tokens: [],
  })

  return {
    refresh: async () => result(),
    applyChange: async () => result(),
    getResult: () => result(),
    getTokens: () => [],
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    dispose: () => undefined,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

/**
 * The text of the rows currently on screen. Rows the view has retired stay in the DOM holding
 * whatever they last rendered, so reading the container itself reports folded rows as visible.
 */
function visibleText(): string {
  const rows = document.querySelectorAll('.editor-virtualized-row[data-editor-virtual-row]')
  return [...rows].map((row) => row.textContent ?? '').join('\n')
}

function typeText(data: string): void {
  editorRoot().dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data,
      inputType: 'insertText',
    }),
  )
}

type Chord = {
  readonly mod?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
}

function pressFold(keyName: string, shift = false): void {
  press('k', { mod: true })
  press(keyName, { mod: true, shift })
}

/**
 * Presses a chord as written here rather than whichever one the keymap currently carries, so a
 * command that moves to another key stops arriving instead of being followed to where it went.
 */
function press(keyName: string, chord: Chord): void {
  const mac = detectPlatform() === 'mac'

  editorRoot().dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: keyName,
      altKey: chord.alt === true,
      ctrlKey: chord.mod === true && !mac,
      metaKey: chord.mod === true && mac,
      shiftKey: chord.shift === true,
    }),
  )
}

/** The commands a host still binds once it has narrowed the keymap for a document nobody may edit. */
function readonlyCommands(platform: 'mac' | 'windows' | 'linux'): readonly EditorCommandId[] {
  return filterEditorKeymapLayersByCommandPacks(
    defaultEditorKeymapLayers(platform),
    readonlySafeEditorCommandPacks,
  ).flatMap((layer) => layer.bindings.map((binding) => binding.command))
}

/** The chevrons the gutter is offering, which is one for every row that heads a region. */
function visibleFoldToggles(): readonly HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.editor-virtualized-fold-toggle:not([hidden])',
    ),
  ]
}

function clickFoldToggle(): void {
  visibleFoldToggles()[0]!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  )
}

describe('fold command wiring', () => {
  // A pack is what carries a binding into a layer, and the dispatch set is what routes the id, so a
  // command missing from either is one nothing can reach.
  it.each(FOLD_COMMAND_IDS)('gives %s a pack, a chord and a route', (command) => {
    expect(editorCommandPackForCommand(command)).toBe('folding')
    expect(isEditorFoldCommand(command)).toBe(true)

    for (const platform of ['mac', 'windows', 'linux'] as const) {
      expect(defaultEditorKeyBindings(platform).map((binding) => binding.command)).toContain(
        command,
      )
      // Hiding rows changes no text, so narrowing a keymap to what a reader may press keeps them.
      expect(readonlyCommands(platform)).toContain(command)
    }
  })
})

describe('fold nesting', () => {
  it('numbers regions by containment however they arrive', () => {
    // Ranges reach the model per provider, so the outer block need not precede the one inside it.
    const nesting = foldNesting([TREE_FOLDS[1]!, TREE_FOLDS[2]!, TREE_FOLDS[0]!])

    expect(nesting.map((entry) => entry.level)).toEqual([1, 2, 1])
    expect(nesting.map((entry) => entry.parentIndex)).toEqual([-1, 0, -1])
    expect(nesting[1]!.fold).toBe(TREE_FOLDS[1])
  })
})

describe('fold commands', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — polyfilling Highlight constructor for tests
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {
      plugins: [lineGutterPlugin(), foldGutterPlugin()],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
  })

  async function open(
    text: string,
    folds: readonly FoldRange[],
    documentId = 'main.ts',
  ): Promise<void> {
    setEditorSyntaxSessionFactory(() => createFoldSyntaxSession(folds))
    editor.openDocument({ documentId, languageId: 'typescript', text })
    await flushMicrotasks()
  }

  async function openTree(caretRow = TREE_LINES.length - 1): Promise<void> {
    await open(TREE_TEXT, TREE_FOLDS)
    editor.setSelection(rowStart(TREE_TEXT, caretRow))
  }

  it('folds the region the caret sits at the very end of', async () => {
    await open(TREE_TEXT, TREE_FOLDS)
    // The last column of a region's last row: the caret is inside the rows the
    // region hides, so the command has something to do there.
    const innerEnd = rowStart(TREE_TEXT, 3) + TREE_LINES[3]!.length
    editor.setSelection(innerEnd)

    expect(editor.dispatchCommand('editor.fold')).toBe(true)
    // The innermost region containing the caret, not the block around it.
    expect(visibleText()).toContain('  if (a) {')
    expect(visibleText()).toContain('  tail()')
    expect(visibleText()).not.toContain('    inner()')
  })

  it('folds and unfolds the region at the caret from the keyboard', async () => {
    await openTree(2)

    pressFold('[')
    expect(visibleText()).toContain('  if (a) {')
    expect(visibleText()).not.toContain('    inner()')

    pressFold(']')
    expect(visibleText()).toContain('    inner()')
  })

  it('folds the region under the caret together with everything inside it', async () => {
    await openTree(0)

    pressFold('[', true)
    expect(visibleText()).toContain('function outer() {')
    expect(visibleText()).not.toContain('  tail()')

    // Opening the outer block alone leaves the inner one as the recursion left it.
    pressFold(']')
    expect(visibleText()).toContain('  if (a) {')
    expect(visibleText()).not.toContain('    inner()')

    pressFold(']', true)
    expect(visibleText()).toContain('    inner()')
  })

  it('folds one nesting level at a time', async () => {
    await openTree()

    pressFold('2')
    expect(visibleText()).not.toContain('    inner()')
    expect(visibleText()).toContain('  tail()')
    expect(visibleText()).toContain('  more()')

    pressFold('j')
    pressFold('1')
    expect(visibleText()).not.toContain('  if (a) {')
    expect(visibleText()).not.toContain('  more()')
    expect(visibleText()).toContain('function next() {')
  })

  it('leaves the region the caret sits in unfolded', async () => {
    await openTree(2)

    expect(editor.dispatchCommand('editor.foldLevel1')).toBe(true)
    expect(visibleText()).toContain('  tail()')
    expect(visibleText()).not.toContain('  more()')
  })

  it.each(EDITOR_FOLD_LEVELS)(
    'folds the regions %i deep in a deeply nested file',
    async (level) => {
      await open(DEEP_TEXT, DEEP_FOLDS)
      editor.setSelection(rowStart(DEEP_TEXT, DEEP_LINES.length - 1))

      pressFold(String(level))
      expect(visibleText()).toContain(DEEP_LINES[level - 1]!)
      expect(visibleText()).not.toContain(DEEP_LINES[level]!)
    },
  )

  it('folds every level at once from the keyboard, and unfolds them again', async () => {
    await openTree()

    pressFold('0')
    expect(visibleText()).not.toContain('  if (a) {')
    expect(visibleText()).not.toContain('  more()')

    pressFold('j')
    expect(visibleText()).toContain('    inner()')
    expect(visibleText()).toContain('  more()')
  })

  it('makes a region out of the selection and folds it', async () => {
    await openTree()
    editor.setSelection(rowStart(TREE_TEXT, 9), rowEnd(TREE_TEXT, 11))

    pressFold(',')
    expect(visibleText()).toContain('header')
    expect(visibleText()).not.toContain('data one')
    expect(visibleText()).not.toContain('data two')
    // Left inside the rows it hides, the caret is what would open the region again.
    expect(editor.getState().cursor).toEqual({ row: 9, column: 0 })

    pressFold(',', true)
    expect(visibleText()).toContain('data one')
  })

  it('leaves out the row a selection only reached the head of', async () => {
    await openTree()
    editor.setSelection(rowStart(TREE_TEXT, 9), rowStart(TREE_TEXT, 12))

    pressFold(',')
    expect(visibleText()).toContain('header')
    expect(visibleText()).not.toContain('data one')
    expect(visibleText()).not.toContain('data two')
    expect(visibleText()).toContain('done()')
  })

  it('drops the regions drawn in one file when the next one opens', async () => {
    await openTree()
    editor.setSelection(rowStart(TREE_TEXT, 9), rowEnd(TREE_TEXT, 11))
    pressFold(',')
    expect(visibleText()).not.toContain('data one')

    await open(PLAIN_TEXT, [], 'other.ts')
    expect(visibleText()).toContain('plain 10')
    expect(visibleText()).toContain('plain 11')
    // Nothing in this file is foldable, so the gutter has nothing to offer either.
    expect(visibleFoldToggles()).toHaveLength(0)

    editor.setSelection(rowStart(PLAIN_TEXT, 9), rowEnd(PLAIN_TEXT, 11))
    expect(editor.dispatchCommand('editor.removeManualFoldingRanges')).toBe(false)
  })

  it('keeps the indentation fallback out while a reparse is in flight', async () => {
    await open(BRACE_TEXT, [blockFold(BRACE_TEXT, 0, 2)])
    editor.setSelection(rowEnd(BRACE_TEXT, 1))

    // Tab puts a reparse in flight, and the keystroke after it rebuilds the fold projections inside
    // that window — where a fallback joining the parse would describe the block a second time,
    // one row short of where the parse ends it.
    press('Tab', {})
    expect(editor.getState().syntaxStatus).toBe('loading')
    typeText('y')

    clickFoldToggle()
    expect(visibleText()).toContain('after()')
    expect(visibleText()).not.toContain('body()')
    expect(visibleText()).not.toContain('}')
  })

  it('lets a parse whose folds cross the indentation fallback displace it', async () => {
    // The fallback stands in the registry from the moment the document opens; the parse landing
    // must displace it before its own folds are validated against the set, or the crossing pair
    // throws instead of resolving in the grammar's favor.
    await open(CROSSING_TEXT, [blockFold(CROSSING_TEXT, 2, 4)])

    expect(visibleFoldToggles()).toHaveLength(1)
    editor.setSelection(rowEnd(CROSSING_TEXT, 2))
    expect(editor.dispatchCommand('editor.fold')).toBe(true)
    expect(visibleText()).toContain('  two {')
    expect(visibleText()).not.toContain('  three')
    expect(visibleText()).not.toContain('}')
  })

  it('lets later syntax folds replace an authoritative empty result', async () => {
    await open(CROSSING_TEXT, [])
    expect(visibleFoldToggles()).toHaveLength(0)

    editor.setSyntaxFolds([blockFold(CROSSING_TEXT, 2, 4)])

    editor.setSelection(rowEnd(CROSSING_TEXT, 2))
    expect(editor.dispatchCommand('editor.fold')).toBe(true)
    expect(visibleText()).toContain('  two {')
    expect(visibleText()).not.toContain('  three')
    expect(visibleText()).not.toContain('}')
  })

  it('declines a selection that would hide nothing', async () => {
    await openTree(9)

    expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(false)
    expect(editor.dispatchCommand('editor.removeManualFoldingRanges')).toBe(false)
  })

  it('offers no region to fold with folding off', async () => {
    editor.dispose()
    editor = createVisibleEditor(container, {
      folding: false,
      plugins: [lineGutterPlugin(), foldGutterPlugin()],
    })
    await openTree(2)

    expect(visibleFoldToggles()).toHaveLength(0)
    for (const command of FOLD_COMMAND_IDS) {
      expect(editor.dispatchCommand(command), command).toBe(false)
    }
    editor.setSelection(rowStart(TREE_TEXT, 9), rowEnd(TREE_TEXT, 11))
    expect(editor.dispatchCommand('editor.createFoldingRangeFromSelection')).toBe(false)

    editor.openDocument({ documentId: 'plain', languageId: null, text: TREE_TEXT })
    await flushMicrotasks()
    expect(editor.dispatchCommand('editor.foldAll')).toBe(false)
    expect(visibleText()).toContain('    inner()')
  })

  it('gives a hand-drawn region a level alongside the parsed ones', async () => {
    await openTree()
    editor.setSelection(rowStart(TREE_TEXT, 9), rowEnd(TREE_TEXT, 11))
    editor.dispatchCommand('editor.createFoldingRangeFromSelection')
    editor.dispatchCommand('editor.unfold')
    expect(visibleText()).toContain('data one')

    editor.setSelection(rowStart(TREE_TEXT, 12))
    expect(editor.dispatchCommand('editor.foldLevel1')).toBe(true)
    expect(visibleText()).not.toContain('data one')
    expect(visibleText()).toContain('header')
  })

  it('keeps a hand-drawn region on its rows when text above it grows', async () => {
    await openTree()
    editor.setSelection(rowStart(TREE_TEXT, 9), rowEnd(TREE_TEXT, 11))
    editor.dispatchCommand('editor.createFoldingRangeFromSelection')

    editor.dispatchCommand('cursorDocumentStart')
    typeText('x'.repeat(40))

    expect(editor.materializeFullText().startsWith('x'.repeat(40))).toBe(true)
    expect(visibleText()).toContain('header')
    expect(visibleText()).not.toContain('data one')
    expect(visibleText()).not.toContain('data two')
  })

  describe('rows a collapsed region hides', () => {
    /** Collapses the block on row 1, which is the one hiding rows 2 and 3. */
    async function foldInner(): Promise<void> {
      await openTree(1)
      expect(editor.dispatchCommand('editor.fold')).toBe(true)
      expect(visibleText()).not.toContain('    inner()')
    }

    it('opens the region and leaves the caret where it was sent', async () => {
      await foldInner()

      editor.setSelection(rowStart(TREE_TEXT, 2) + 4)

      expect(visibleText()).toContain('    inner()')
      expect(editor.getState().cursor).toEqual({ row: 2, column: 4 })
    })

    it('opens every region standing between the destination and the reader', async () => {
      await openTree(0)
      pressFold('[', true)
      expect(visibleText()).not.toContain('  if (a) {')

      editor.setSelection(rowStart(TREE_TEXT, 2) + 4)

      expect(visibleText()).toContain('  if (a) {')
      expect(visibleText()).toContain('    inner()')
      expect(editor.getState().cursor).toEqual({ row: 2, column: 4 })
    })

    it('reveals a selection by its head, so the match a find hit made is on screen', async () => {
      await foldInner()

      editor.setSelection(rowStart(TREE_TEXT, 2) + 4, rowStart(TREE_TEXT, 2) + 9)

      expect(visibleText()).toContain('    inner()')
      expect(editor.getState().cursor).toEqual({ row: 2, column: 9 })
    })

    // The header row is on screen the whole time a region is collapsed, so a destination on it is
    // already somewhere the reader can look, and opening the region would undo a fold they just made.
    it('stays collapsed for a destination on the header row it keeps on screen', async () => {
      await foldInner()

      editor.setSelection(rowEnd(TREE_TEXT, 1))

      expect(visibleText()).not.toContain('    inner()')
      expect(editor.getState().cursor).toEqual({ row: 1, column: TREE_LINES[1]!.length })
    })

    // The other way a caret ends up in rows nobody is shown: the region grows over it, from a parse
    // that landed while the reader was working. Nothing asked to go anywhere, so nothing is revealed
    // — the region that reached over the caret is the one that gives way.
    it('drops the collapse a restated region would have closed over the caret', async () => {
      await open(TREE_TEXT, [blockFold(TREE_TEXT, 0, 1)])
      editor.setSelection(rowStart(TREE_TEXT, 3))
      expect(editor.fold(rowStart(TREE_TEXT, 0))).toBe(true)
      expect(visibleText()).not.toContain('  if (a) {')

      editor.setSyntaxFolds([blockFold(TREE_TEXT, 0, 5)])

      expect(visibleText()).toContain('  }')
      expect(editor.getState().cursor).toEqual({ row: 3, column: 0 })
    })

    // A collapse withheld from the range that restated it sits on no range at all, so nothing the
    // reader presses reaches it. Letting it go is the only reading that does not shut the region
    // again the moment the caret moves on and the next parse lands.
    it('keeps no collapse behind when a restated region gives way to the caret', async () => {
      await open(TREE_TEXT, [blockFold(TREE_TEXT, 0, 1)])
      editor.setSelection(rowStart(TREE_TEXT, 3))
      expect(editor.fold(rowStart(TREE_TEXT, 0))).toBe(true)

      editor.setSyntaxFolds([blockFold(TREE_TEXT, 0, 5)])

      expect(editor.unfoldAll()).toBe(false)
    })

    it('leaves the region the caret was in open once the caret has moved away', async () => {
      await open(TREE_TEXT, [blockFold(TREE_TEXT, 0, 1)])
      editor.setSelection(rowStart(TREE_TEXT, 3))
      expect(editor.fold(rowStart(TREE_TEXT, 0))).toBe(true)
      editor.setSyntaxFolds([blockFold(TREE_TEXT, 0, 5)])
      expect(visibleText()).toContain('  }')

      // The reader leaves, and the next parse names the same rows the way another provider would.
      editor.setSelection(rowStart(TREE_TEXT, 6))
      editor.setSyntaxFolds([{ ...blockFold(TREE_TEXT, 0, 5), type: 'indent' }])

      expect(visibleText()).toContain('  }')
    })

    it('keeps a collapse the reader made over the caret when a parse restates it', async () => {
      await open(TREE_TEXT, [blockFold(TREE_TEXT, 0, 5)])
      editor.setSelection(rowStart(TREE_TEXT, 3))
      expect(editor.foldAll()).toBe(true)
      expect(visibleText()).not.toContain('  }')

      editor.setSyntaxFolds([blockFold(TREE_TEXT, 0, 4)])

      expect(visibleText()).not.toContain('  }')
    })

    // Walking a document is not asking to be taken somewhere: motion already steps over the rows a
    // region hides, so the reader who collapsed it keeps it collapsed.
    it('stays collapsed when the caret walks into it instead', async () => {
      await foldInner()
      editor.setSelection(rowStart(TREE_TEXT, 1))

      press('ArrowDown', {})

      expect(visibleText()).not.toContain('    inner()')
      expect(editor.getState().cursor.row).toBe(4)
    })
  })
})
