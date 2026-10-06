import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// NOT-PORTABLE: Direct tests require built sibling workspace packages.
import { VirtualizedTextView } from '@singapore-editor/core/testing'
import {
  Editor,
  createEditorHighlighterOperation,
  createEditorStructuralOperation,
  type EditorStructuralOperationContext,
  type EditorHighlighterOperationContext,
  type DocumentRead,
} from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import {
  createEmptySyntaxResult,
  EditorTokenStore,
  toEditorTokenStore,
  type EditorToken,
  type EditorTokenInput,
} from '@singapore-editor/core/syntax'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  createDiffRegionStore,
  createTextDiff,
  diffRowAtEvent,
  diffSyntaxBackend,
  joinRenderLines,
} from '../src'
import { createDiffGutterContribution } from '../src/diffGutter'
import { diffGutterDigits } from '../src/gutters'
import { projectDiffSyntaxTokens } from '../src/diffSyntax'
import type { DiffFile, DiffGutterSide, DiffPlugin, DiffRenderRow, DiffSyntaxBackend } from '../src'
import { installHighlightPolyfill } from './support/highlightPolyfill'

/**
 * The ported behaviour spec (§2.6). `test/DiffView.test.ts` was the only written record of what
 * parity means; its cases live here, minus the ones covering surfaces §2.4 established have no
 * consumers at all — hunk navigation and the entire `splitPane` option layer — and minus split
 * layout, which is host work now (§3.1).
 */

beforeAll(() => {
  installHighlightPolyfill()
})

const mounted: { editor: Editor; host: HTMLElement }[] = []

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.editor.dispose()
    entry.host.remove()
  }
})

describe('diff plugin — rows and expansion (§C3, §C5)', () => {
  it('publishes rows for the host to push into the editor', () => {
    const { plugin, host } = mountDiff({ file: singleHunkDiff() })

    expect(plugin.getRows().map((row) => row.text)).toEqual(['one', 'two', 'TWO'])
    expect(host.textContent).toContain('TWO')
  })

  it('renders one stacked buffer row per projection row, keeping the §C4 identity', () => {
    const { plugin, host } = mountDiff({ file: prefixSkippedDiff(), side: 'stacked' })

    const indices = [...host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')].map(
      (element) => Number(element.dataset.editorVirtualRow),
    )
    expect(indices).toEqual(plugin.getRows().map((_row, index) => index))
  })

  it('toggles an expandable hunk row from a gutter click, and shows a pointer over it', () => {
    // Ported from DiffView.test.ts:113-134. The click lands in the gutter band, where no text row
    // sits and `.editor-virtualized-gutter` is pointer-events:none — so this exercises the Y
    // hit-test the plugin carries (§3.4), not `closest()`.
    const { plugin, host } = mountDiff({ file: prefixSkippedDiff() })
    const view = queryScrollElement(host)

    expect(host.textContent).toContain('Show 2 unmodified lines')

    view.dispatchEvent(pointerEvent('mousemove', 0))
    expect(view.style.cursor).toBe('pointer')

    clickGutter(view, 0)

    expect(plugin.getRows().map((row) => row.text)).toContain('Hide 2 unmodified lines')
    expect(host.textContent).toContain('alpha')
    expect(host.textContent).toContain('beta')

    view.dispatchEvent(pointerEvent('mouseleave', 0))
    expect(view.style.cursor).toBe('')
  })

  it('names the diff row and pane under a pointer event', () => {
    const { plugin, host } = mountDiff({ file: singleHunkDiff(), side: 'new' })
    const element = host.querySelector<HTMLElement>('[data-editor-virtual-row="1"]')
    const press = pointerEvent('mousedown', rowY(element!))
    element?.dispatchEvent(press)

    expect(diffRowAtEvent(press)).toEqual({ side: 'new', rowIndex: 1, rows: plugin.getRows() })

    // The gutter band: no row element under the pointer, so the row geometry answers.
    const gutterPress = pointerEvent('mousedown', 0)
    queryScrollElement(host).dispatchEvent(gutterPress)
    expect(diffRowAtEvent(gutterPress)?.rowIndex).toBe(0)

    const outside = pointerEvent('mousedown', 0)
    document.body.dispatchEvent(outside)
    expect(diffRowAtEvent(outside)).toBeNull()
  })

  it('names a buffer row after wrapped segments shift its display index', () => {
    const { editor, plugin, host } = mountDiff({
      file: createTextDiff({
        oldFile: { path: 'a.txt', text: `${'long '.repeat(200)}\nbefore\n` },
        newFile: { path: 'a.txt', text: `${'long '.repeat(200)}\nafter\n` },
      }),
    })
    editor.setWordWrap(true)
    const target = plugin.getRows().findIndex((row) => row.type === 'addition')
    const view: unknown = Reflect.get(editor, 'view')
    if (!(view instanceof VirtualizedTextView)) throw new Error('Expected text view')
    view.scrollToRow(target)
    const row = view.getState().mountedRows.find((row) => row.bufferRow === target)!
    expect(row.index).toBeGreaterThan(target)
    const event = pointerEvent('mousedown', rowY(row.element) - queryScrollElement(host).scrollTop)
    queryScrollElement(host).dispatchEvent(event)
    expect(diffRowAtEvent(event)?.rowIndex).toBe(target)
  })

  it('refuses a caret on a separator it cannot expand', () => {
    // A partial diff — a patch with no file text behind it — still shows how much was skipped and
    // cannot open it. The label is real buffer text either way, and a collapsed caret copies its
    // own line, so resting one here would put `Show 2 unmodified lines` on the clipboard.
    const { plugin, host } = mountDiff({ file: partialSkippedDiff() })
    const separator = plugin.getRows().findIndex((row) => row.type === 'hunk')
    expect(separator).toBeGreaterThanOrEqual(0)
    expect(plugin.getRows()[separator]?.expandable).toBe(false)

    // Dispatched at the scroll element, which is where a real press in the gutter band lands and
    // the only place happy-dom delivers one — it does not bubble a mousedown from a row.
    const view = queryScrollElement(host)
    const mousedown = pointerEvent('mousedown', 0)
    view.dispatchEvent(mousedown)

    expect(mousedown.defaultPrevented).toBe(true)
    // And it is still only *expandable* separators that answer a click or show a pointer.
    view.dispatchEvent(pointerEvent('mousemove', 0))
    expect(view.style.cursor).toBe('')
  })

  it('refuses a press on a separator at every click count', async () => {
    // Asserted on FOCUS, which is the one thing that discriminates here.
    // `defaultPrevented` cannot: the editor's own mousedown handler calls `preventDefault()` for
    // its own reasons, so the flag reads true whether or not the plugin refused. Nor can the caret:
    // happy-dom gives every element a zero-sized rect, so the editor's word- and line-selection
    // paths resolve an offset at the end of the document no matter where the press was, with or
    // without this plugin. What IS decisive is that `InputSelectionController.handleMouseDown`
    // calls `view.focusInput()` as soon as no press participant claimed the press — so an editor
    // that never took focus is one whose selection handling never ran.
    const { host } = mountDiff({ file: prefixSkippedDiff() })
    const view = queryScrollElement(host)

    // 2 selects a word of `Show 2 unmodified lines`, 3 the whole line, 4 the whole document.
    for (const detail of [1, 2, 3, 4]) {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      view.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientY: 0,
          detail,
        }),
      )
      await flushPromises()

      expect(host.contains(document.activeElement)).toBe(false)
    }
  })

  it('keeps arrow keys off a separator row', () => {
    const { editor, plugin } = mountDiff({ file: prefixSkippedDiff() })
    const rows = plugin.getRows()
    expect(rows[0]?.type).toBe('hunk')
    const firstContent = (rows[0]?.text.length ?? 0) + 1

    editor.setSelection(firstContent)
    editor.dispatchCommand('cursorLeft')
    expect(editor.getState().cursor.row).toBe(1)

    editor.dispatchCommand('cursorDocumentStart')
    expect(editor.getState().cursor.row).toBe(1)
  })

  it('toggles the unmodified tail after the last hunk', () => {
    // Ported from DiffView.test.ts:136-151. A trailing region carries `hunkIndex === undefined`
    // (projection.ts:294-310) — the case a hunk-ordinal mirror can never address, which is why
    // §C5 keys on `expandKey` and forbids hosts from mirroring at all.
    const { plugin, host } = mountDiff({ file: suffixSkippedDiff() })

    expect(host.textContent).toContain('Show 2 unmodified lines')
    const separator = plugin.getRows().find((row) => row.type === 'hunk')
    expect(separator?.hunkIndex).toBeUndefined()

    clickRow(host, plugin.getRows().indexOf(separator!))

    expect(host.textContent).toContain('Hide 2 unmodified lines')
    expect(host.textContent).toContain('beta')
    expect(host.textContent).toContain('gamma')
  })

  it('owns expansion state and reports it by region key (§C5)', () => {
    const { plugin, host } = mountDiff({ file: prefixSkippedDiff() })
    const separator = plugin.getRows().find((row) => row.type === 'hunk')!

    expect(plugin.getExpandedRegions()).toEqual(new Set())

    plugin.toggleRegion(separator.expandKey!)
    expect([...plugin.getExpandedRegions()]).toEqual([separator.expandKey])

    plugin.toggleRegion(separator.expandKey!)
    expect(plugin.getExpandedRegions()).toEqual(new Set())
    expect(host.textContent).toContain('Show 2 unmodified lines')
  })

  it('drops expansion state when a different file is pushed', () => {
    const { plugin } = mountDiff({ file: prefixSkippedDiff() })
    plugin.toggleRegion(plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)
    expect(plugin.getExpandedRegions().size).toBe(1)

    plugin.setFile(otherPathDiff())

    expect(plugin.getExpandedRegions()).toEqual(new Set())
  })
})

describe('diff plugin — gutter (§3.3)', () => {
  it('labels stacked lanes with old and new numbers and a change indicator', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'stacked' })

    expect(gutterLaneTexts(host)).toContainEqual(['1', '1', ''])
    expect(gutterLaneTexts(host)).toContainEqual(['2', '', '-'])
    expect(gutterLaneTexts(host)).toContainEqual(['', '2', '+'])
  })

  it('tones the new lane and not the old one for an addition (§3.3, trap 2)', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'stacked' })
    const addition = gutterCellForIndicator(host, '+')

    expect(laneTone(addition, 'old')).toBe('default')
    expect(laneTone(addition, 'new')).toBe('added')
    expect(laneTone(addition, 'indicator')).toBe('added')
  })

  it('tones the old lane and not the new one for a deletion (§3.3, trap 2)', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'stacked' })
    const deletion = gutterCellForIndicator(host, '-')

    expect(laneTone(deletion, 'old')).toBe('deleted')
    expect(laneTone(deletion, 'new')).toBe('default')
    expect(laneTone(deletion, 'indicator')).toBe('deleted')
  })

  it('tints the whole gutter row, so the tint covers a leading inset', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'stacked' })
    const addition = gutterCellForIndicator(host, '+')
    const deletion = gutterCellForIndicator(host, '-')

    expect(addition.parentElement?.classList).toContain('editor-diff-gutter-band-addition')
    expect(deletion.parentElement?.classList).toContain('editor-diff-gutter-band-deletion')
    // The cell stays clear, or its tint would stack on the row's.
    for (const cell of gutterCells(host)) {
      expect(cell.classList).not.toContain('editor-diff-gutter-tinted')
    }
  })

  it('shows only its own side’s number lane in split mode', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'old' })

    for (const cell of gutterCells(host)) {
      expect(cell.querySelector('.editor-diff-gutter-lane-new')).toBeNull()
      expect(cell.querySelector('.editor-diff-gutter-lane-old')).not.toBeNull()
    }
  })

  it('publishes lane geometry as CSS columns rather than approximating it (§3.3, trap 1)', () => {
    const { host } = mountDiff({ file: singleHunkDiff(), side: 'stacked' })
    const columns = queryScrollElement(host).style.getPropertyValue('--editor-diff-gutter-columns')

    // Three lanes, all in px: two number lanes from `max(chars, 3) * charWidth + 8` and a 12px
    // indicator. A `1fr` anywhere here means the geometry was guessed.
    expect(columns.split(' ')).toHaveLength(3)
    expect(columns).not.toContain('fr')
    expect(columns.endsWith('12px')).toBe(true)
  })

  it('republishes columns when the lane split changes but the total does not', () => {
    // The stacked total is `max(old, 3)*cw + 8 + max(new, 3)*cw + 8 + 12`, which is SYMMETRIC in the
    // two lane character counts — so a file whose old/new digit widths are transposed has an
    // identical total and a different split. Memoizing the publish on the total therefore keeps
    // serving the previous columns, and since lanes are `overflow: hidden; text-align: right`, the
    // under-sized one silently clips its leading digit.
    //
    // Driven at the contribution directly: producing a transposed split from real projections
    // needs a contrived pair of files, because the projected row count floors both lanes equally.
    const published: string[] = []
    let digits = diffGutterDigits([numberedRow(1000, 10)])
    const contribution = createDiffGutterContribution({
      side: 'stacked',
      tint: 'row',
      getDigits: () => digits,
      resolveRow: () => null,
      onLayout: (layout) => published.push(layout.lanes.map((lane) => lane.width).join(',')),
    })

    const width = () => contribution.width({ lineCount: 1, metrics: laneMetrics })
    const first = width()
    digits = diffGutterDigits([numberedRow(10, 1000)])
    const second = width()

    expect(second).toBe(first)
    expect(published).toEqual(['40,32,12', '32,40,12'])
  })

  it('never queries the DOM to update a cell (§3.3, trap 3)', () => {
    const { host, plugin } = mountDiff({ file: prefixSkippedDiff(), side: 'stacked' })
    const cells = gutterCells(host)
    expect(cells.length).toBeGreaterThan(0)

    const spies = cells.map((cell) => vi.spyOn(cell, 'querySelector'))
    try {
      // Force a full row update: every mounted cell is asked to re-render.
      plugin.toggleRegion(plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('diff plugin — syntax (§C10, §C11)', () => {
  it('projects full-file syntax tokens into split diff rows', () => {
    // Unchanged from DiffView.test.ts:166-193 — a pure function over the projection.
    const tokens = projectDiffSyntaxTokens({
      rows: [{ newLineNumber: 2, oldLineNumber: 2, text: 'beta', type: 'context' }],
      side: 'old',
      sources: [
        {
          lineStarts: [0, 6, 11],
          side: 'old',
          tokens: [{ start: 6, end: 10, style: { color: 'red' } }],
        },
      ],
    })

    expect(tokens).toEqual([{ start: 0, end: 4, style: { color: 'red' } }])
  })

  it('projects stacked rows from old and new full-file token streams', () => {
    // Unchanged from DiffView.test.ts:195-228.
    const tokens = projectDiffSyntaxTokens({
      rows: [
        { oldLineNumber: 1, text: 'old', type: 'deletion' },
        { newLineNumber: 1, text: 'new', type: 'addition' },
      ],
      side: 'stacked',
      sources: [
        { lineStarts: [0], side: 'old', tokens: [{ start: 0, end: 3, style: { color: 'red' } }] },
        { lineStarts: [0], side: 'new', tokens: [{ start: 0, end: 3, style: { color: 'blue' } }] },
      ],
    })

    expect(tokens).toEqual([
      { start: 0, end: 3, style: { color: 'red' } },
      { start: 4, end: 7, style: { color: 'blue' } },
    ])
  })

  it('defaults syntax highlighting to tree-sitter instead of shiki', () => {
    expect(diffSyntaxBackend(undefined)).toEqual({ kind: 'tree-sitter' })
  })

  it('passes full file text to the tree-sitter syntax backend', async () => {
    const parsedTexts: string[] = []
    mountDiff({
      file: singleHunkDiff(),
      syntaxBackend: createRecordingSyntaxBackend(parsedTexts),
      syntaxHighlight: true,
    })

    await flushPromises()

    expect(parsedTexts).toContain('one\ntwo\n')
  })

  it('creates tree-sitter sessions from diff syntax service requests', async () => {
    const sessionOptions: EditorStructuralOperationContext[] = []
    mountDiff({
      file: typescriptDiff(),
      syntaxBackend: createRecordingSyntaxBackend([], sessionOptions),
      syntaxHighlight: true,
    })

    await flushPromises()

    expect(sessionOptions).toContainEqual(
      expect.objectContaining({
        documentId: 'note.ts#diff-old',
        includeCaptures: true,
        includeHighlights: true,
        languageId: 'typescript',
        syntaxMode: 'full',
      }),
    )
    const read = sessionOptions[0]?.initialRead
    expect(read?.text.readRange(0, read.text.length)).toBe('keep\nold\nskip\n')
  })

  it('uses a host-owned highlighter provider instead of constructing a diff worker', async () => {
    const createSession = vi.fn((_context: EditorHighlighterOperationContext) => ({
      dispose: vi.fn(),
      analyze: vi.fn(async () => ({
        tokens: EditorTokenStore.fromTokens([{ start: 0, end: 4, style: { color: 'gold' } }]),
      })),
    }))
    mountDiff({
      file: typescriptDiff(),
      syntaxBackend: {
        kind: 'highlighter',
        provider: { operation: createEditorHighlighterOperation(createSession) },
      },
      syntaxHighlight: true,
    })

    await flushUntil(() => createSession.mock.calls.length >= 2)

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'note.ts#diff-old', languageId: 'typescript' }),
    )
    const calls = createSession.mock.calls
    const old = calls.find(([options]) => options.documentId === 'note.ts#diff-old')?.[0]
    expect(old?.initialRead.text.readRange(0, old.initialRead.text.length)).toBe(
      'keep\nold\nskip\n',
    )
  })

  it('recolors existing diff sessions and releases theme subscriptions on close', async () => {
    let color = 'red'
    const listeners = new Set<() => void>()
    const refresh = async () => ({
      tokens: EditorTokenStore.fromTokens([{ start: 5, end: 8, style: { color } }]),
    })
    const createSession = vi.fn(() => ({
      analyze: refresh,
      dispose: vi.fn(),
      onDidChangeTheme: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }))
    const { plugin } = mountDiff({
      file: typescriptDiff(),
      syntaxBackend: {
        kind: 'highlighter',
        provider: { operation: createEditorHighlighterOperation(createSession) },
      },
      syntaxHighlight: true,
    })
    await flushUntil(() => plugin.getTokens().length > 0)
    expect(plugin.getTokens()[0]?.style.color).toBe('red')
    const sessions = createSession.mock.calls.length
    color = 'blue'
    for (const listener of listeners) listener()
    await flushUntil(() => plugin.getTokens()[0]?.style.color === 'blue')
    expect(plugin.getTokens().every((token) => token.style.color === 'blue')).toBe(true)
    expect(createSession).toHaveBeenCalledTimes(sessions)
    plugin.setFile(null)
    expect(listeners.size).toBe(0)
  })

  it('exposes projected tokens for the host to re-apply after setText', async () => {
    const { plugin } = mountDiff({
      file: typescriptDiff(),
      syntaxBackend: createTokenSyntaxBackend(),
      syntaxHighlight: true,
    })

    await flushUntil(() => plugin.getTokens().length >= 2)

    expect(plugin.getTokens()).toEqual(
      expect.arrayContaining([expect.objectContaining({ style: { color: 'rgb(1, 2, 3)' } })]),
    )
  })

  it('announces tokens to the host when the parse lands, not just on a row change', async () => {
    // The parse is async and rows do not change when it settles, so `onDidChangeTokens` is the
    // ONLY path that colours the first render. Polling `getTokens()` cannot see that: silence the
    // emitter and every other syntax assertion here still passes, while a real §C3 host mounts
    // permanently uncoloured. So assert what actually reaches the editor.
    const setTokens = vi.spyOn(Editor.prototype, 'setTokens')
    try {
      const { plugin } = mountDiff({
        file: typescriptDiff(),
        syntaxBackend: createTokenSyntaxBackend(),
        syntaxHighlight: true,
      })
      await flushUntil(() => plugin.getTokens().length >= 2)
      await flushUntil(() => appliedTokens(setTokens).length > 0)

      expect(appliedTokens(setTokens).at(-1)).toEqual(plugin.getTokens())
    } finally {
      setTokens.mockRestore()
    }
  })

  it('re-projects tokens onto the new rows across an expansion toggle (§C10)', async () => {
    // `DiffView` re-ran the whole parse per toggle and leaned on re-applying a cached token array
    // (DiffView.ts:558). The parse does not depend on expansion, so the streams are cached and
    // re-projected synchronously instead — `getTokens()` is already correct when `toggleRegion`
    // returns, before the host's `setText` runs.
    //
    // Asserted on OFFSETS, not on a count. Expansion inserts rows above the changed lines and so
    // moves every offset after them; the token count is identical before and after, which means a
    // count assertion stays green with the re-projection deleted entirely. Offsets are the only
    // thing that distinguishes "re-projected" from "stale", and a stale projection is precisely
    // the §C10 failure — colour smeared across `alpha`/`beta` with `old`/`new` left bare.
    const { plugin } = mountDiff({
      file: prefixSkippedTypescriptDiff(),
      syntaxBackend: createTokenSyntaxBackend(),
      syntaxHighlight: true,
    })
    await flushUntil(() => plugin.getTokens().length > 0)

    const collapsed = joinRenderLines(plugin.getRows())
    expect(tokenTexts(plugin.getTokens(), collapsed)).toEqual(['old', 'new'])

    plugin.toggleRegion(plugin.getRows().find((row) => row.type === 'hunk')!.expandKey!)

    // Same tokens, re-anchored: they must still land on `old`/`new` in the now-longer buffer.
    const expanded = joinRenderLines(plugin.getRows())
    expect(expanded).not.toBe(collapsed)
    expect(tokenTexts(plugin.getTokens(), expanded)).toEqual(['old', 'new'])
  })

  it('leaves the editor’s own document language null (§C11)', () => {
    const { editor } = mountDiff({ file: typescriptDiff() })

    // A real language here would tree-sitter-parse the *interleaved* buffer and feed that parse
    // into folds, brackets and injections (syntaxController.ts:655-668).
    expect(editor.getState().languageId).toBeNull()
  })
})

describe('diff plugin — host-owned document (§C3, §C6)', () => {
  it('applies a theme without rebuilding the editor', () => {
    // `DiffViewOptions.theme` had no setter, so platform rebuilt the whole view on a colour-mode
    // change (diff-view.tsx:69). `Editor.setTheme` exists.
    const { editor, host } = mountDiff({ file: singleHunkDiff() })

    editor.setTheme({ foregroundColor: '#abcdef', syntax: { keyword: '#123456' } })

    const view = queryScrollElement(host)
    expect(view.style.getPropertyValue('--editor-foreground')).toBe('#abcdef')
    expect(view.style.getPropertyValue('--editor-syntax-keyword')).toBe('#123456')
  })

  it('renders the text of an identical file rather than a message', () => {
    const { plugin, host } = mountDiff({
      file: createTextDiff({
        oldFile: { path: 'note.txt', text: 'same\nlines\n' },
        newFile: { path: 'note.txt', text: 'same\nlines\n' },
      }),
    })

    expect(plugin.getRows().map((row) => row.type)).toEqual(['context', 'context'])
    expect(host.textContent).toContain('same')
  })

  it('still says no changes when a patch-only file has no text to show', () => {
    const { plugin, host } = mountDiff({
      file: { ...createTextDiff({ oldFile: null, newFile: null }), isPartial: true },
    })

    expect(plugin.getRows().map((row) => row.type)).toEqual(['empty'])
    expect(host.textContent).toContain('No changes')
  })

  it('clears its rows when the file is removed', () => {
    const { plugin } = mountDiff({ file: singleHunkDiff() })

    plugin.setFile(null)

    expect(plugin.getRows()).toEqual([])
  })
})

// ------------------------------------------------------------------------------------- harness

type MountOptions = {
  readonly file?: DiffFile
  readonly side?: DiffGutterSide
  readonly syntaxBackend?: DiffSyntaxBackend
  readonly syntaxHighlight?: boolean
}

/**
 * The host half of §C3, in miniature: construct the editor from `createDiffEditorOptions()` and
 * push the plugin's rows in as text with their tokens.
 */
function mountDiff(options: MountOptions = {}): {
  editor: Editor
  host: HTMLElement
  plugin: DiffPlugin
} {
  const host = document.createElement('div')
  host.className = 'editor-diff-view'
  document.body.appendChild(host)

  const plugin = createDiffPlugin({
    mode: 'document',
    side: options.side ?? 'stacked',
    syntaxBackend: options.syntaxBackend,
    syntaxHighlight: options.syntaxHighlight ?? false,
  })
  const editor = createVisibleEditor(host, {
    ...createDiffEditorOptions(),
    plugins: [plugin],
  })
  mounted.push({ editor, host })

  const push = (): void => {
    editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
  }
  plugin.onDidChangeRows(push)
  plugin.onDidChangeTokens(() => editor.setTokens(plugin.getTokens()))

  plugin.setFile(options.file ?? singleHunkDiff())
  return { editor, host, plugin }
}

/** A patch with no file text behind it: separators that report a skipped range but cannot open it. */
function partialSkippedDiff(): DiffFile {
  const file = prefixSkippedDiff()
  return { ...file, isPartial: true, oldLines: [], newLines: [] }
}

function singleHunkDiff(): DiffFile {
  return createTextDiff({
    oldFile: { path: 'note.txt', text: 'one\ntwo\n' },
    newFile: { path: 'note.txt', text: 'one\nTWO\n' },
  })
}

function otherPathDiff(): DiffFile {
  return createTextDiff({
    oldFile: { path: 'other.txt', text: 'one\ntwo\n' },
    newFile: { path: 'other.txt', text: 'one\nTWO\n' },
  })
}

function prefixSkippedDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.txt', text: 'alpha\nbeta\ngamma\n' },
    newFile: { path: 'note.txt', text: 'alpha\nbeta\nGAMMA\n' },
  })
}

function prefixSkippedTypescriptDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.ts', text: 'alpha\nbeta\nold\n', languageId: 'typescript' },
    newFile: { path: 'note.ts', text: 'alpha\nbeta\nnew\n', languageId: 'typescript' },
  })
}

function suffixSkippedDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.txt', text: 'alpha\nbeta\ngamma\n' },
    newFile: { path: 'note.txt', text: 'ALPHA\nbeta\ngamma\n' },
  })
}

function typescriptDiff(): DiffFile {
  return createTextDiff({
    contextLines: 0,
    oldFile: { path: 'note.ts', text: 'keep\nold\nskip\n', languageId: 'typescript' },
    newFile: { path: 'note.ts', text: 'keep\nnew\nskip\n', languageId: 'typescript' },
  })
}

const laneMetrics = { characterWidth: 8, rowHeight: 20 }

function numberedRow(oldLineNumber: number, newLineNumber: number): DiffRenderRow {
  return { type: 'context', text: 'content', oldLineNumber, newLineNumber }
}

function queryScrollElement(host: HTMLElement): HTMLElement {
  const view = host.querySelector<HTMLElement>('.editor-virtualized')
  if (!view) throw new Error('Expected a mounted editor')
  return view
}

function gutterCells(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.editor-diff-gutter')].filter(
    (cell) => !cell.hidden,
  )
}

function gutterLaneTexts(host: HTMLElement): string[][] {
  return gutterCells(host).map((cell) =>
    [...cell.querySelectorAll<HTMLElement>('.editor-diff-gutter-lane')].map(
      (lane) => lane.textContent ?? '',
    ),
  )
}

function gutterCellForIndicator(host: HTMLElement, indicator: string): HTMLElement {
  const cell = gutterCells(host).find(
    (candidate) =>
      candidate.querySelector('.editor-diff-gutter-lane-indicator')?.textContent === indicator,
  )
  if (!cell) throw new Error(`Expected a gutter cell showing "${indicator}"`)
  return cell
}

function laneTone(cell: HTMLElement, lane: string): string {
  const element = cell.querySelector<HTMLElement>(`.editor-diff-gutter-lane-${lane}`)
  if (!element) throw new Error(`Expected a ${lane} lane`)
  return element.dataset.diffTone ?? ''
}

function clickGutter(view: HTMLElement, y: number): void {
  view.dispatchEvent(pointerEvent('mousedown', y))
  view.dispatchEvent(pointerEvent('click', y))
}

function rowY(element: HTMLElement): number {
  const top = Number.parseFloat(
    element.style.transform.replace('translateY(', '') || element.style.top,
  )
  return top + 1
}

function clickRow(host: HTMLElement, row: number): void {
  const element = host.querySelector<HTMLElement>(`[data-editor-virtual-row="${row}"]`)
  if (!element) throw new Error(`Expected virtual row ${row}`)
  element.dispatchEvent(pointerEvent('mousedown', rowY(element)))
  element.dispatchEvent(pointerEvent('click', rowY(element)))
}

/** `cancelable`, or `preventDefault()` is a no-op and `defaultPrevented` can never be true. */
function pointerEvent(type: string, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY, detail: 1 })
}

function createRecordingSyntaxBackend(
  parsedTexts: string[],
  sessionOptions: EditorStructuralOperationContext[] = [],
): DiffSyntaxBackend {
  return {
    kind: 'tree-sitter',
    provider: {
      operation: createEditorStructuralOperation((options) => {
        sessionOptions.push(options)
        let currentRead = options.initialRead
        let current = createEmptySyntaxResult()
        return {
          foldingSupport: 'supported',
          dispose: () => undefined,
          getResult: () => current,
          getTokens: () => current.tokens,
          getSnapshotVersion: () => currentRead.revision.point.textVersion,
          analyze: async (read) => {
            currentRead = read
            parsedTexts.push(read.text.readRange(0, read.text.length))
            current = createEmptySyntaxResult()
            return current
          },
        }
      }),
    },
  }
}

function createTokenSyntaxBackend(): DiffSyntaxBackend {
  return {
    kind: 'tree-sitter',
    provider: {
      operation: createEditorStructuralOperation((options) => {
        let currentRead = options.initialRead
        let current = syntaxResultForOptions(options, currentRead)
        return {
          foldingSupport: 'supported',
          dispose: () => undefined,
          getResult: () => current,
          getTokens: () => current.tokens,
          getSnapshotVersion: () => currentRead.revision.point.textVersion,
          analyze: async (read) => {
            currentRead = read
            current = syntaxResultForOptions(options, read)
            return current
          },
        }
      }),
    },
  }
}

function syntaxResultForOptions(options: EditorStructuralOperationContext, read: DocumentRead) {
  const target = options.documentId.endsWith('#diff-old') ? 'old' : 'new'
  const start = read.text.readRange(0, read.text.length).indexOf(target)
  const tokens: EditorToken[] =
    start === -1 ? [] : [{ end: start + target.length, start, style: { color: 'rgb(1, 2, 3)' } }]

  return {
    ...createEmptySyntaxResult({
      language: {
        includeCaptures: true,
        includeHighlights: true,
        languageId: options.languageId,
        mode: 'full',
      },
      requestedRanges: [{ startIndex: 0, endIndex: read.text.length }],
      snapshot: {
        documentId: options.documentId,
        length: read.text.length,
        version: read.revision.point.textVersion,
      },
    }),
    tokens,
  }
}

/** The text each token actually covers, so an assertion pins anchoring rather than a count. */
function tokenTexts(tokens: readonly EditorToken[], text: string): string[] {
  return tokens.map((token) => text.slice(token.start, token.end))
}

type SetTokensSpy = { readonly mock: { readonly calls: readonly [EditorTokenInput][] } }

/** Non-empty token arrays that reached a real `Editor`, in call order. */
function appliedTokens(setTokens: SetTokensSpy): readonly (readonly EditorToken[])[] {
  return setTokens.mock.calls
    .map(([tokens]) => toEditorTokenStore(tokens).toTokens())
    .filter((tokens) => tokens.length > 0)
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function flushUntil(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (done()) return
    await flushPromises()
  }
}

it('caches stacked rows until file or expansion changes', () => {
  const plugin = createDiffPlugin({ mode: 'document', side: 'old' })
  plugin.setFile(prefixSkippedDiff())
  const collapsed = plugin.getStackedRows()
  expect(plugin.getStackedRows()).toBe(collapsed)
  expect(collapsed.map((row) => row.type)).toContain('addition')
  expect(plugin.getRows().map((row) => row.type)).not.toContain('addition')
  const key = collapsed.find((row) => row.expandable)?.expandKey
  if (!key) throw new Error('Expected an expandable region')
  plugin.toggleRegion(key)
  const expanded = plugin.getStackedRows()
  expect(expanded).not.toBe(collapsed)
  expect(expanded.map((row) => row.text)).toContain('alpha')
  expect(plugin.getStackedRows()).toBe(expanded)
  plugin.toggleRegion(key)
  expect(plugin.getStackedRows()).toEqual(collapsed)
  expect(plugin.getStackedRows()).not.toBe(expanded)
  plugin.setFile(singleHunkDiff())
  expect(plugin.getStackedRows().map((row) => row.text)).toEqual(['one', 'two', 'TWO'])
  plugin.setFile(null)
  expect(plugin.getStackedRows()).toEqual([])
  expect(plugin.getStackedRows()).toBe(plugin.getStackedRows())
})

it('keeps private stacked expansion separate and follows a shared region store', () => {
  const regions = createDiffRegionStore()
  const left = createDiffPlugin({ mode: 'document', side: 'old', regions })
  const right = createDiffPlugin({ mode: 'document', side: 'new', regions })
  const independent = createDiffPlugin({ mode: 'document', side: 'new' })
  const stacked = createDiffPlugin({ mode: 'document', regions })
  const file = prefixSkippedDiff()
  for (const plugin of [left, right, independent, stacked]) plugin.setFile(file)
  const collapsed = independent.getStackedRows()
  const sharedCollapsed = right.getStackedRows()
  const key = collapsed.find((row) => row.expandable)?.expandKey
  if (!key) throw new Error('Expected an expandable region')
  left.toggleRegion(key)
  expect(left.getStackedRows().map((row) => row.text)).toContain('alpha')
  expect(right.getStackedRows()).toEqual(left.getStackedRows())
  expect(right.getStackedRows()).not.toBe(sharedCollapsed)
  expect(independent.getStackedRows()).toEqual(collapsed)
  expect(independent.getExpandedRegions().size).toBe(0)
  expect(stacked.getStackedRows()).toBe(stacked.getRows())
  independent.toggleRegion(key)
  right.toggleRegion(key)
  expect(left.getStackedRows()).toEqual(collapsed)
  expect(independent.getStackedRows().map((row) => row.text)).toContain('alpha')
})
