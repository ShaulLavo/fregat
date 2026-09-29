import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'
import { detectPlatform } from '@tanstack/hotkeys'
import type { Editor, EditorOptions } from '../src/editor'
import type { EditorPerformanceDiagnostic } from '../src/editor/performanceDiagnostics'
import { IndentationFoldIndex } from '../src/editor/indentationFoldIndex'
import { createVisibleEditor } from './factories/visibleEditor'
import type { EditorPlugin, EditorViewSnapshot } from '../src/plugins'
import {
  createEmptySyntaxResult,
  createEmptySyntaxSession,
  type EditorSyntaxResult,
} from '../src/public/syntax'
import {
  resetEditorInstanceCount,
  setHighlightRegistry,
  setEditorSyntaxSessionFactory,
} from '../src/public/testing'

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

const highlightsMap = new Map<string, Highlight>()
const mockRegistry = {
  set: (name: string, highlight: Highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name: string) => highlightsMap.delete(name),
}

class MockHighlight extends Set<Range> {}

/** A trailing blank line inside the block is what the off-side rule decides the fate of. */
const INDENTED_TEXT = ['def outer():', '    first()', '    second()', '', 'after()'].join('\n')
const BODY_END = INDENTED_TEXT.indexOf('\n\nafter()')
const HEADER_END = INDENTED_TEXT.indexOf('\n    first()')

/** A tab and a run of spaces that stand at one column only where the tab is worth two of them. */
const TAB_TEXT = ['head:', '\tone', '  two'].join('\n')

/**
 * The two rule shapes the walk itself behaves differently for: a block that is its own indentation,
 * and one a token closes. Which shape each language we ship gets is pinned on the records themselves,
 * in test/languageConfiguration.test.ts.
 */
const FOLDING_RULE_SHAPES = [
  { languageId: 'python', comment: '#', offSide: true },
  { languageId: 'typescript', comment: '//', offSide: false },
] as const

/** A region marked in `comment` syntax, on rows sharing one indentation so only a marker can fold. */
function markedText(comment: string): string {
  return [
    `${comment} region imports`,
    'import a',
    'import b',
    `${comment} endregion`,
    'main()',
  ].join('\n')
}

/** Another language's comment opener, which the rules for an unnamed document would still accept. */
function otherComment(comment: string): string {
  return comment === '#' ? '//' : '#'
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

/** Retired rows keep the text they last showed, so only the mounted ones say what is on screen. */
function visibleText(): string {
  return [...document.querySelectorAll('.editor-virtualized-row:not([hidden])')]
    .map((row) => row.textContent ?? '')
    .join('\n')
}

function foldToggles(): readonly HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.editor-virtualized-fold-toggle:not([hidden])',
    ),
  ]
}

function foldKeys(): readonly string[] {
  return foldToggles().map((toggle) => toggle.dataset.editorFoldKey ?? '')
}

function foldStates(): readonly string[] {
  return foldToggles().map((toggle) => toggle.dataset.editorFoldState ?? '')
}

function clickFoldToggle(index = 0): void {
  foldToggles()[index]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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

function recordFallbackScans(): EditorPerformanceDiagnostic[] {
  const scans: EditorPerformanceDiagnostic[] = []
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) => {
    if (event.name === 'editor.fallbackFoldRanges') scans.push(event)
  })
  return scans
}

describe('fold ranges without a grammar', () => {
  let container: HTMLElement
  let editor: Editor

  function mount(options: EditorOptions = {}): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {
      plugins: [lineGutterPlugin(), foldGutterPlugin()],
      ...options,
    })
  }

  /** Constructor options require replacing the editor that beforeEach mounted. */
  function remount(options: EditorOptions): void {
    editor.dispose()
    container.remove()
    mount(options)
  }

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — polyfilling Highlight constructor for tests
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    mount()
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['supported', 'pending'] as const)(
    'hides provisional indentation while %s structural folds settle',
    async (foldingSupport) => {
      let resolveResult!: (result: EditorSyntaxResult) => void
      const pending = new Promise<EditorSyntaxResult>((resolve) => {
        resolveResult = resolve
      })
      const snapshots: EditorViewSnapshot[] = []
      let support = foldingSupport
      setEditorSyntaxSessionFactory(() => ({
        ...createEmptySyntaxSession(),
        get foldingSupport() {
          return support
        },
        refresh: () => pending,
      }))
      editor.addPlugin({
        activate: (context) =>
          context.registerViewContribution({
            createContribution: () => ({
              update: (snapshot) => {
                snapshots.push(snapshot)
              },
              dispose() {},
            }),
          }),
      })
      editor.openDocument({
        documentId: 'config.js',
        languageId: 'javascript',
        text: INDENTED_TEXT,
      })
      expect(foldKeys()).toEqual([])
      expect(snapshots.at(-1)?.syntaxStatus).toBe('loading')
      expect(snapshots.at(-1)?.paintLayers).toBeNull()

      support = 'supported'
      resolveResult({
        ...createEmptySyntaxResult(),
        folds: [
          {
            startIndex: HEADER_END - 1,
            endIndex: BODY_END,
            startLine: 0,
            endLine: 2,
            type: 'object',
            languageId: 'javascript',
          },
        ],
      })
      await vi.waitFor(() => expect(snapshots.at(-1)?.syntaxStatus).toBe('ready'))
      expect(foldKeys()).toEqual([`javascript:object:${HEADER_END - 1}:${BODY_END}`])
      expect(
        snapshots
          .filter((snapshot) => snapshot.syntaxStatus === 'ready')
          .every((snapshot) =>
            snapshot.foldMarkers.every((marker) => !marker.key.includes(':indent:')),
          ),
      ).toBe(true)
    },
  )

  it('treats a supported empty fold result as authoritative', async () => {
    setEditorSyntaxSessionFactory(() => ({
      ...createEmptySyntaxSession(),
      foldingSupport: 'supported',
    }))
    editor.openDocument({ documentId: 'config.js', languageId: 'javascript', text: INDENTED_TEXT })
    await vi.waitFor(() => expect(editor.getState().syntaxStatus).toBe('ready'))
    expect(foldKeys()).toEqual([])
  })

  it('restores indentation folding if the pending structural provider fails', async () => {
    setEditorSyntaxSessionFactory(() => ({
      ...createEmptySyntaxSession(),
      foldingSupport: 'pending',
      refresh: async () => {
        throw new RangeError('Parser unavailable')
      },
    }))
    editor.openDocument({ documentId: 'config.js', languageId: 'javascript', text: INDENTED_TEXT })
    expect(foldKeys()).toEqual([])
    await vi.waitFor(() => expect(editor.getState().syntaxStatus).toBe('error'))
    await vi.waitFor(() => expect(foldKeys()).toHaveLength(1))
  })

  it('keeps indentation folding when the syntax provider has no folding support', async () => {
    setEditorSyntaxSessionFactory(() => createEmptySyntaxSession())
    editor.openDocument({ documentId: 'config.js', languageId: 'javascript', text: INDENTED_TEXT })
    expect(foldKeys()).toHaveLength(0)
    await vi.waitFor(() => expect(editor.getState().syntaxStatus).toBe('ready'))
    await vi.waitFor(() => expect(foldKeys()).toHaveLength(1))
  })

  it('folds a document no grammar can describe by its indentation', async () => {
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })

    await vi.waitFor(() => expect(foldStates()).toEqual(['expanded']))
    clickFoldToggle()

    expect(visibleText()).toContain('def outer():')
    expect(visibleText()).toContain('after()')
    expect(visibleText()).not.toContain('first()')
    expect(visibleText()).not.toContain('second()')
  })

  // Both halves are what naming the language buys: a document we cannot name is read as prose, whose
  // blank line separates blocks and whose regions may be marked in any comment syntax at all.
  it.each(FOLDING_RULE_SHAPES)(
    'reads $languageId by its own blank-line rule and comment syntax',
    async ({ languageId, comment, offSide }) => {
      editor.openDocument({ documentId: `blank.${languageId}`, languageId, text: INDENTED_TEXT })
      const bodyEnd = offSide ? BODY_END : BODY_END + 1
      await vi.waitFor(() =>
        expect(foldKeys()).toEqual([`${languageId}:indent:${HEADER_END}:${bodyEnd}`]),
      )

      const own = markedText(comment)
      editor.openDocument({ documentId: `own.${languageId}`, languageId, text: own })
      await vi.waitFor(() =>
        expect(foldKeys()).toEqual([
          `${languageId}:region:${own.indexOf('\nimport a')}:${own.indexOf('\nmain()')}`,
        ]),
      )

      const other = markedText(otherComment(comment))
      editor.openDocument({ documentId: `other.${languageId}`, languageId, text: other })
      expect(editor.foldAll()).toBe(false)
      expect(foldKeys()).toEqual([])
    },
  )

  // Refusing a marker because we cannot name the language would mark nothing in an unnamed file at
  // all, and a document with no grammar is indistinguishable from prose.
  it('reads a document with no language off-side, after any comment opener', async () => {
    editor.openDocument({ documentId: 'notes', text: INDENTED_TEXT })
    await vi.waitFor(() => expect(foldKeys()).toEqual([`plain:indent:${HEADER_END}:${BODY_END}`]))

    const marked = markedText('--')
    editor.openDocument({ documentId: 'marked', text: marked })

    await vi.waitFor(() =>
      expect(foldKeys()).toEqual([
        `plain:region:${marked.indexOf('\nimport a')}:${marked.indexOf('\nmain()')}`,
      ]),
    )
  })

  it('measures a tab in the columns it stands for before comparing indentation', async () => {
    remount({ tabSize: 2 })
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: TAB_TEXT })

    // One region, not two: the space-indented row is beside the tab-indented one, not inside it.
    await vi.waitFor(() =>
      expect(foldKeys()).toEqual([
        `python:indent:${TAB_TEXT.indexOf('\n\tone')}:${TAB_TEXT.length}`,
      ]),
    )
    clickFoldToggle()

    expect(visibleText()).toContain('head:')
    expect(visibleText()).not.toContain('one')
    expect(visibleText()).not.toContain('two')
  })

  it('folds an explicit region its lines share one indentation with', async () => {
    const text = markedText('#')
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text })

    await vi.waitFor(() =>
      expect(foldKeys()).toEqual([
        `python:region:${text.indexOf('\nimport a')}:${text.indexOf('\nmain()')}`,
      ]),
    )
    clickFoldToggle()

    expect(visibleText()).toContain('# region imports')
    expect(visibleText()).toContain('main()')
    expect(visibleText()).not.toContain('import a')
    expect(visibleText()).not.toContain('# endregion')
  })

  it('finds a region a keystroke creates, once the walk catches up', async () => {
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: 'def outer():\npass' })
    expect(foldToggles()).toHaveLength(0)

    editor.dispatchCommand('cursorDocumentEnd')
    editor.dispatchCommand('cursorLineStart')
    typeCharacter(' ')

    expect(editor.materializeFullText()).toBe('def outer():\n pass')
    // Reading the whole document is not a cost the keystroke carries, so the
    // region appears on the frame after it rather than inside it.
    expect(foldToggles()).toHaveLength(0)

    await vi.waitFor(() => expect(foldStates()).toEqual(['expanded']))
    clickFoldToggle()
    expect(visibleText()).not.toContain('pass')
  })

  it('keeps a region collapsed when the grammar takes over the rows it described', async () => {
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    await vi.waitFor(() => expect(foldStates()).toEqual(['expanded']))
    clickFoldToggle()
    expect(foldStates()).toEqual(['collapsed'])

    editor.setSyntaxFolds([
      {
        startIndex: HEADER_END - 1,
        endIndex: BODY_END,
        startLine: 0,
        endLine: 2,
        type: 'function_definition',
        languageId: 'python',
      },
    ])

    expect(foldKeys()).toEqual([`python:function_definition:${HEADER_END - 1}:${BODY_END}`])
    expect(foldStates()).toEqual(['collapsed'])
    expect(visibleText()).not.toContain('second()')
  })

  it('keeps folding a language whose grammar describes no folds at all', async () => {
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    await vi.waitFor(() => expect(foldKeys()).toHaveLength(1))

    // Fold queries ship per language. A grammar that parses but was never asked
    // for folds has not answered none of them, and the file still folds.
    editor.setSyntaxFolds([])

    expect(foldKeys()).toHaveLength(1)
    clickFoldToggle()
    expect(visibleText()).not.toContain('second()')
  })

  it.each(['background', 'explicit-command'] as const)(
    'finishes unsupported-provider folds through %s after yielding ordinary syntax publication',
    async (completion) => {
      vi.useFakeTimers()
      const scans = recordFallbackScans()
      const complete = vi.spyOn(IndentationFoldIndex.prototype, 'complete')
      const step = vi.spyOn(IndentationFoldIndex.prototype, 'step')
      setEditorSyntaxSessionFactory(() => ({
        ...createEmptySyntaxSession(),
        foldingSupport: 'unsupported',
      }))
      try {
        editor.openDocument({
          documentId: 'unsupported.txt',
          languageId: 'unknown',
          text: 'root\n  child\n'.repeat(2_000),
        })
        await vi.advanceTimersByTimeAsync(0)

        expect(editor.getState().syntaxStatus).toBe('ready')
        expect(complete).not.toHaveBeenCalled()
        expect(step).not.toHaveBeenCalled()
        expect(scans).toHaveLength(0)

        await vi.advanceTimersByTimeAsync(150)

        expect(step).toHaveBeenCalledOnce()
        expect(step.mock.results[0]?.value).toBe(false)
        expect(scans).toHaveLength(0)
        expect(foldKeys()).toEqual([])

        if (completion === 'explicit-command') {
          expect(editor.fold(0)).toBe(true)
          expect(complete).toHaveBeenCalledOnce()
          expect(foldStates()[0]).toBe('collapsed')
        }

        await vi.runAllTimersAsync()

        expect(scans).toHaveLength(1)
        expect(scans[0]?.detail).toMatchObject({
          trigger: completion === 'background' ? 'attach' : 'explicit-command',
          outcome: 'completed',
          rowsRead: 4_001,
          foldCount: 2_000,
          materializations: 0,
        })
        expect(complete).toHaveBeenCalledTimes(completion === 'background' ? 0 : 1)
        expect(foldStates()[0]).toBe(completion === 'background' ? 'expanded' : 'collapsed')
      } finally {
        complete.mockRestore()
        step.mockRestore()
      }
    },
  )

  it('publishes usable text before scanning fallback folds, then publishes its markers', async () => {
    vi.useFakeTimers()
    const scans = recordFallbackScans()
    const paintedText: string[] = []
    const layouts: number[] = []
    remount({
      onInitialPaint: (event) => {
        if (event.phase !== 'text') return
        expect(scans).toHaveLength(0)
        expect(foldKeys()).toEqual([])
        paintedText.push(visibleText())
      },
    })
    editor.addPlugin({
      activate: (context) =>
        context.registerViewContribution({
          createContribution: () => ({
            update: (snapshot, kind) => {
              if (kind === 'layout') layouts.push(snapshot.foldMarkers.length)
            },
            dispose() {},
          }),
        }),
    })
    scans.length = 0
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })

    expect(paintedText).toHaveLength(1)
    expect(paintedText[0]).toContain('def outer():')
    expect(editor.materializeFullText()).toBe(INDENTED_TEXT)
    expect(scans).toHaveLength(0)

    await vi.runAllTimersAsync()

    expect(scans).toHaveLength(1)
    expect(foldKeys()).toEqual([`python:indent:${HEADER_END}:${BODY_END}`])
    expect(layouts).toContain(1)
  })

  it('scans the edited document when typing precedes fallback readiness', async () => {
    vi.useFakeTimers()
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    editor.setSelection(0)
    typeCharacter('prefix\n')

    expect(foldKeys()).toEqual([])
    expect(editor.materializeFullText()).toBe(`prefix\n${INDENTED_TEXT}`)

    await vi.runAllTimersAsync()

    expect(foldKeys()).toEqual([`python:indent:${HEADER_END + 7}:${BODY_END + 7}`])
    expect(editor.fold(HEADER_END + 7)).toBe(true)
    expect(visibleText()).toContain('prefix')
    expect(visibleText()).not.toContain('second()')
  })

  it('drops outgoing markers and scans only the newest replacement', async () => {
    vi.useFakeTimers()
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    await vi.runAllTimersAsync()
    expect(foldKeys()).toHaveLength(1)
    const scans = recordFallbackScans()

    editor.openDocument({ documentId: 'pending.py', languageId: 'python', text: INDENTED_TEXT })
    expect(foldKeys()).toEqual([])
    const replacement = 'new root\n  one\n  two\ndone'
    editor.openDocument({ documentId: 'new.py', languageId: 'python', text: replacement })
    expect(foldKeys()).toEqual([])

    await vi.runAllTimersAsync()

    expect(scans).toHaveLength(1)
    expect(editor.materializeFullText()).toBe(replacement)
    expect(foldKeys()).toEqual([
      `python:indent:${replacement.indexOf('\n')}:${replacement.indexOf('\ndone')}`,
    ])
  })

  it.each(['clear', 'dispose'] as const)(
    'does not scan abandoned startup folds after %s',
    async (action) => {
      vi.useFakeTimers()
      const scans = recordFallbackScans()
      editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
      editor[action]()
      scans.length = 0

      await vi.runAllTimersAsync()

      expect(scans).toHaveLength(0)
      expect(foldKeys()).toEqual([])
      expect(visibleText()).not.toContain('second()')
    },
  )

  it.each(['fold', 'toggleFold', 'foldAll'] as const)(
    'honors an immediate public %s request and keeps the deferred task from repeating it',
    async (action) => {
      vi.useFakeTimers()
      const scans = recordFallbackScans()
      editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
      editor.setSelection(HEADER_END)
      expect(foldKeys()).toEqual([])
      expect(editor[action]()).toBe(true)
      expect(foldStates()).toEqual(['collapsed'])

      await vi.runAllTimersAsync()

      expect(scans).toHaveLength(1)
      expect(foldStates()).toEqual(['collapsed'])
      expect(visibleText()).not.toContain('second()')
    },
  )

  it('honors the keyboard fold chord before fallback readiness', async () => {
    vi.useFakeTimers()
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    editor.setSelection(HEADER_END)
    const mac = detectPlatform() === 'mac'
    for (const key of ['k', '[']) {
      editorRoot().dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key,
          ctrlKey: !mac,
          metaKey: mac,
        }),
      )
    }

    expect(foldStates()).toEqual(['collapsed'])
    await vi.runAllTimersAsync()
    expect(visibleText()).not.toContain('second()')
  })

  it('publishes newly available markers when an immediate unfold changes no folds', () => {
    const layouts: number[] = []
    editor.addPlugin({
      activate: (context) =>
        context.registerViewContribution({
          createContribution: () => ({
            update: (snapshot, kind) => {
              if (kind === 'layout') layouts.push(snapshot.foldMarkers.length)
            },
            dispose() {},
          }),
        }),
    })
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    editor.setSelection(HEADER_END)
    layouts.length = 0

    expect(editor.unfold()).toBe(false)
    expect(foldStates()).toEqual(['expanded'])
    expect(layouts).toEqual([1])
  })

  it('reuses topology on a body edit and queries markers without enumerating all folds', async () => {
    vi.useFakeTimers()
    const text = Array.from({ length: 2_000 }, (_, row) => `head ${row}\n  body`).join('\n')
    editor.openDocument({ documentId: 'large.txt', text })
    await vi.runAllTimersAsync()
    const traversal = vi.spyOn(IndentationFoldIndex.prototype, 'all')
    const work = recordFallbackScans()
    try {
      const offset = text.indexOf('body') + 2
      editor.setSelection(offset)
      editor.edit({ from: offset, to: offset, text: 'X' })
      await vi.runAllTimersAsync()
      expect(work).toHaveLength(1)
      expect(work[0]?.detail).toMatchObject({
        rowsRead: 1,
        propagationRows: 0,
        materializations: 0,
      })
      expect(work[0]?.detail?.factBlocksReused).toBeGreaterThan(25)
      expect(traversal).not.toHaveBeenCalled()
      expect(editor.fold(0)).toBe(true)
      expect(traversal).not.toHaveBeenCalled()
      expect(foldStates()[0]).toBe('collapsed')
    } finally {
      traversal.mockRestore()
    }
  })

  it('keeps lazily read marker coordinates attached to the snapshot that published them', async () => {
    vi.useFakeTimers()
    const snapshots: EditorViewSnapshot[] = []
    editor.addPlugin({
      activate: (context) =>
        context.registerViewContribution({
          createContribution: () => ({
            update: (snapshot) => {
              snapshots.push(snapshot)
            },
            dispose() {},
          }),
        }),
    })
    editor.openDocument({ documentId: 'main.py', languageId: 'python', text: INDENTED_TEXT })
    await vi.runAllTimersAsync()
    const before = snapshots.at(-1)!
    const offset = INDENTED_TEXT.indexOf('first') + 2
    editor.edit({ from: offset, to: offset, text: 'more' })
    await vi.runAllTimersAsync()
    expect(before.foldMarkers[0]).toMatchObject({ startOffset: HEADER_END, endOffset: BODY_END })
    expect(snapshots.at(-1)?.foldMarkers[0]).toMatchObject({
      startOffset: HEADER_END,
      endOffset: BODY_END + 4,
    })
  })
})
