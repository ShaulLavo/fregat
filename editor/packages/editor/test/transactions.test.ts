import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { createPlugin, type EditorViewScope } from '../src/createPlugin'
import {
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
  createPieceTableSnapshot,
  materializePieceTableFullText,
  pieceTableContainsUnusualLineTerminators,
  pieceTableDocumentText,
  type EditorTextTransaction,
} from '../src/public/document'
import { resolveSelection } from '../src/selections'
import { setHighlightRegistry } from '../src/public/testing'

const editors: Editor[] = []
beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {})
  setHighlightRegistry({ set() {}, delete: () => true } as never)
})
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  document.body.replaceChildren()
  setHighlightRegistry(undefined)
  vi.unstubAllGlobals()
})

function mount(text = 'abc', onChange?: () => void) {
  const transactions: EditorTextTransaction[] = []
  let scope!: EditorViewScope
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, {
    defaultText: text,
    onChange,
    plugins: [
      createPlugin({
        name: 'transactions',
        view(api) {
          scope = api
          api.onDidTransaction((event) => transactions.push(event))
        },
      }),
    ],
  })
  editors.push(editor)
  return { editor, scope, transactions, host }
}

describe('exact plugin transactions on the simple API', () => {
  it('keeps logical batches separate inside a coalesced operation and carries origins and author', () => {
    const { editor, scope, transactions } = mount()
    const author = { participant: 'peer' }
    editor.runInOperation(() => {
      scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
      scope.applyEdits([{ from: 2, to: 2, text: 'y' }], undefined, {
        origin: 'remote',
        history: 'skip',
        author,
      })
      scope.applyEdits([{ from: 3, to: 3, text: 'z' }], undefined, {
        origin: 'replay',
        history: 'skip',
      })
      scope.applyEdits([{ from: 0, to: 1, text: 'A' }], undefined, {
        origin: 'external',
        history: 'skip',
      })
      scope.applyEdits([{ from: 4, to: 4, text: '!' }], undefined, {
        origin: 'view',
        history: 'skip',
      })
    })
    expect(transactions.map((event) => event.origin)).toEqual([
      'local',
      'remote',
      'replay',
      'external',
      'view',
    ])
    expect(
      transactions.map((event) => materializePieceTableFullText(event.snapshotBefore)),
    ).toEqual(['abc', 'axbc', 'axybc', 'axyzbc', 'Axyzbc'])
    expect(transactions.map((event) => event.edits)).toEqual([
      [{ from: 1, to: 1, text: 'x' }],
      [{ from: 2, to: 2, text: 'y' }],
      [{ from: 3, to: 3, text: 'z' }],
      [{ from: 0, to: 1, text: 'A' }],
      [{ from: 4, to: 4, text: '!' }],
    ])
    expect(transactions[1]!.author).toBe(author)
    expect(transactions[0]!.sourceViewId).toEqual(expect.any(String))
    expect(editor.getState().canUndo).toBe(true)
  })

  it('observes programmatic replacement on the simple setText path', () => {
    const { editor, transactions } = mount('abc')
    editor.setText('next\r\n')
    expect(transactions).toHaveLength(1)
    expect(materializePieceTableFullText(transactions[0]!.snapshotBefore)).toBe('abc')
    expect(transactions[0]!.edits).toEqual([{ from: 0, to: 3, text: 'next\n' }])
    editor.setText('next\n')
    expect(transactions).toHaveLength(1)
  })

  it.each(['session', 'static'] as const)(
    'reuses canonical replacement input without a full-text read in %s mode',
    (documentMode) => {
      const { editor, transactions } = mount('abc')
      const fullReads: string[] = []
      vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: { name: string }) => {
        if (event.name === 'textSnapshot.materializeFullText') fullReads.push(event.name)
      })
      expect(editor.materializeFullText()).toBe('abc')
      expect(fullReads).toHaveLength(1)
      fullReads.length = 0

      const canonical = 'next\n'.repeat(10_000)
      const incoming = '﻿' + 'next\r\n'.repeat(10_000)
      editor.setText(incoming, { documentMode })
      expect(fullReads).toEqual([])
      expect(transactions).toHaveLength(1)
      expect(transactions[0]!.edits).toEqual([{ from: 0, to: 3, text: canonical }])
      expect(pieceTableDocumentText(transactions[0]!.snapshotAfter)).toBe(incoming)
      expect(editor.getState().documentMode).toBe(documentMode)

      editor.setText('﻿A\r\nB\r\nC\rD E ', { documentMode })
      expect(fullReads).toEqual([])
      expect(transactions[1]!.edits).toEqual([
        { from: 0, to: canonical.length, text: 'A\nB\nC\nD\nE\n' },
      ])
      expect(pieceTableContainsUnusualLineTerminators(transactions[1]!.snapshotAfter)).toBe(true)
      expect(pieceTableDocumentText(transactions[1]!.snapshotAfter)).toBe(
        '﻿A\r\nB\r\nC\r\nD\r\nE\r\n',
      )
      editor.setText('A\nB\nC\nD\nE\n', { documentMode })
      expect(transactions).toHaveLength(2)
    },
  )

  it('updates view state before a transaction listener authors the next edit', () => {
    const { editor, scope, transactions } = mount()
    scope.onDidTransaction((event) => {
      if (event.edits[0]?.text !== 'x') return
      scope.applyEdits([{ from: 2, to: 2, text: 'y' }])
    })
    scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
    expect(editor.materializeFullText()).toBe('axybc')
    expect(
      transactions.map((event) => materializePieceTableFullText(event.snapshotBefore)),
    ).toEqual(['abc', 'axbc'])
  })

  it('serializes replacement transactions authored from a listener', () => {
    const { editor, scope, transactions } = mount()
    scope.onDidTransaction((event) => {
      if (event.edits[0]?.text === 'first') editor.setText('second')
    })
    const seen: string[] = []
    scope.onDidTransaction((event) => seen.push(materializePieceTableFullText(event.snapshotAfter)))
    editor.setText('first')
    expect(transactions.map((event) => materializePieceTableFullText(event.snapshotAfter))).toEqual(
      ['first', 'second'],
    )
    expect(seen).toEqual(['first', 'second'])
  })

  it('delivers attached-session edits before replacements authored by onChange', () => {
    let editor!: Editor
    let armed = false
    const mounted = mount('abc', () => {
      if (!armed) return
      armed = false
      editor.setText('second')
    })
    editor = mounted.editor
    const session = createDocumentSession('abc')
    editor.attachSession(session)
    armed = true
    session.applyEdits([{ from: 1, to: 1, text: 'x' }])
    expect(
      mounted.transactions.map((event) => materializePieceTableFullText(event.snapshotAfter)),
    ).toEqual(['axbc', 'second'])
  })

  it('retains both replacements when onChange calls setText reentrantly', () => {
    let editor!: Editor
    let armed = false
    const mounted = mount('abc', () => {
      if (!armed) return
      armed = false
      editor.setText('second')
    })
    editor = mounted.editor
    armed = true
    editor.setText('first')
    expect(
      mounted.transactions.map((event) => [
        materializePieceTableFullText(event.snapshotBefore),
        materializePieceTableFullText(event.snapshotAfter),
      ]),
    ).toEqual([
      ['abc', 'first'],
      ['first', 'second'],
    ])
  })

  it('keeps a commit queued during onChange when that callback also replaces the document', () => {
    let editor!: Editor
    let scope!: EditorViewScope
    let armed = false
    const mounted = mount('abc', () => {
      if (!armed) return
      armed = false
      scope.applyEdits([{ from: 2, to: 2, text: 'y' }])
      editor.setText('second')
    })
    editor = mounted.editor
    scope = mounted.scope
    armed = true
    scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
    expect(
      mounted.transactions.map((event) => [
        materializePieceTableFullText(event.snapshotBefore),
        materializePieceTableFullText(event.snapshotAfter),
      ]),
    ).toEqual([
      ['abc', 'axbc'],
      ['axbc', 'axybc'],
      ['axybc', 'second'],
    ])
  })

  it('delivers each commit once to every listener when a transaction callback edits and replaces', () => {
    const { editor, scope, transactions } = mount()
    scope.onDidTransaction((event) => {
      if (event.edits[0]?.text !== 'x') return
      scope.applyEdits([{ from: 2, to: 2, text: 'y' }])
      editor.setText('second')
    })
    const seen: string[] = []
    scope.onDidTransaction((event) => seen.push(materializePieceTableFullText(event.snapshotAfter)))
    scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
    expect(transactions.map((event) => materializePieceTableFullText(event.snapshotAfter))).toEqual(
      ['axbc', 'axybc', 'second'],
    )
    expect(seen).toEqual(['axbc', 'axybc', 'second'])
  })

  it('preserves selection options when the positional selection is omitted', () => {
    const { scope } = mount()
    scope.applyEdits([{ from: 0, to: 0, text: 'x' }], undefined, { selection: { anchor: 3 } })
    expect(scope.getSelections()[0]!.headOffset).toBe(3)
  })

  it('emits actual undo and redo batches and releases a plugin subscription', () => {
    const { editor, scope, transactions } = mount()
    scope.applyEdits([{ from: 1, to: 2, text: 'XY' }])
    editor.dispatchCommand('undo')
    editor.dispatchCommand('redo')
    expect(transactions.map((event) => event.origin)).toEqual(['local', 'undo', 'redo'])
    expect(transactions[1]!.edits).toEqual([{ from: 1, to: 3, text: 'b' }])
    expect(transactions[2]!.edits).toEqual([{ from: 1, to: 2, text: 'XY' }])
    editor.setPlugins([])
    editor.edit({ from: 0, to: 0, text: '!' })
    expect(transactions).toHaveLength(3)
  })

  it('exposes the edits actually applied after Unicode snapping and line-ending normalization', () => {
    const { scope, transactions } = mount('a😀b')
    scope.applyEdits([{ from: 2, to: 2, text: '\r\n' }])
    expect(transactions[0]!.edits).toEqual([{ from: 1, to: 1, text: '\n' }])
  })

  it.each([0, 100, 1000])(
    '%i inert plugins have no transaction recipients or callbacks',
    (count) => {
      const host = document.createElement('div')
      document.body.append(host)
      let callbacks = 0
      const editor = new Editor(host, {
        defaultText: 'abc',
        plugins: Array.from({ length: count }, (_, index) =>
          createPlugin({
            name: `inert-${index}`,
            view(scope) {
              scope.onDispose(() => callbacks++)
            },
          }),
        ),
      })
      editors.push(editor)
      const dispatch = vi.spyOn(Reflect.get(editor, 'transactionListeners'), 'fire')
      const started = performance.now()
      for (let index = 0; index < 10; index++) editor.edit({ from: 0, to: 0, text: 'x' })
      const elapsedMs = performance.now() - started
      console.info(
        JSON.stringify({
          inertPlugins: count,
          edits: 10,
          transactionCallbacks: dispatch.mock.calls.length,
          elapsedMs,
        }),
      )
      expect(dispatch).not.toHaveBeenCalled()
      expect(Reflect.get(editor, 'transactionListeners').size).toBe(0)
      expect(callbacks).toBe(0)
    },
  )
})

describe('atomic reconcile', () => {
  it('rebases tracked ranges and points onto an independent base and preserves point deletion', () => {
    const { scope } = mount('abcdef')
    scope.applyEdits([{ from: 2, to: 2, text: 'XY' }])
    const range = scope.view.trackRanges([{ start: 2, end: 4 }])
    const point = scope.view.trackPoint({ kind: 'point', offset: 3, bias: 'right' })
    scope.reconcile(createPieceTableSnapshot('abXYcdef'), [[{ from: 0, to: 0, text: 'R' }]], {
      edits: [{ from: 0, to: 0, text: 'R' }],
    })
    expect(range.resolve()).toEqual([{ start: 3, end: 5 }])
    expect(point.resolve()).toEqual({ kind: 'live', offset: 4 })
    scope.reconcile(createPieceTableSnapshot('Rabcdef'), [], {
      edits: [{ from: 3, to: 5, text: '' }],
    })
    expect(range.resolve()).toEqual([])
    expect(point.resolve()).toEqual({ kind: 'deleted' })
    scope.reconcile(createPieceTableSnapshot('Rabcdef!'), [], {
      edits: [{ from: 7, to: 7, text: '!' }],
    })
    expect(point.resolve()).toEqual({ kind: 'deleted' })
  })

  it('publishes supplied code-point-safe effective replacements', () => {
    const buffer = createEditorTextBuffer('a😀b')
    const session = createEditorBufferSession(buffer)
    const point = buffer.getDocumentSyncPoint()
    session.reconcile(createPieceTableSnapshot('a😃b'), [], {
      edits: [{ from: 1, to: 3, text: '😃' }],
    })
    expect(buffer.changesSinceDocumentSyncPoint(point, null)?.edits).toEqual([
      { from: 1, to: 3, text: '😃' },
    ])
  })

  it('requires effective edits from runtime callers without changing state', () => {
    const session = createDocumentSession('abc')
    const before = session.getSnapshot()
    expect(() =>
      session.reconcile(createPieceTableSnapshot('xyz'), [], undefined as never),
    ).toThrow('requires effective edits')
    expect(session.getSnapshot()).toBe(before)
    expect(session.materializeFullText()).toBe('abc')
  })

  it('publishes precise distant edits on 100,000 lines and preserves interior selections', () => {
    const text = Array.from(
      { length: 100_000 },
      (_, index) => `const row_${index} = ${index};\n`,
    ).join('')
    const buffer = createEditorTextBuffer(text)
    const session = createEditorBufferSession(buffer)
    const mid = text.indexOf('const row_50000')
    session.setSelection(mid + 5, mid)
    const edits = [
      { from: 0, to: 0, text: 'R' },
      { from: text.length, to: text.length, text: '!' },
    ]
    const point = buffer.getDocumentSyncPoint()
    const events: unknown[] = []
    buffer.subscribe((event) => events.push(event))
    session.reconcile(createPieceTableSnapshot(text), [edits], { edits })
    expect(session.materializeFullText()).toBe('R' + text + '!')
    expect(buffer.changesSinceDocumentSyncPoint(point, null)?.edits).toEqual(edits)
    expect(
      resolveSelection(session.getSnapshot(), session.getSelections().selections[0]!),
    ).toMatchObject({ anchorOffset: mid + 6, headOffset: mid + 1 })
    expect(events).toHaveLength(1)
    expect(buffer.getHistoryGraph().nodes).toHaveLength(1)
  })

  it('rejects mismatched supplied effective edits before changing any state', () => {
    const session = createDocumentSession('abc')
    const before = session.getSnapshot()
    expect(() => session.reconcile(createPieceTableSnapshot('xyz'), [], { edits: [] })).toThrow()
    expect(session.getSnapshot()).toBe(before)
    expect(session.materializeFullText()).toBe('abc')
  })

  it('replaces a base and replays sequential batches with one publication and no transaction echo or history', () => {
    const publications: string[] = []
    const { editor, scope, transactions } = mount('abc', () => publications.push('published'))
    editor.setSelection(2)
    publications.length = 0
    scope.reconcile(
      createPieceTableSnapshot('abc'),
      [[{ from: 0, to: 0, text: 'R' }], [{ from: 4, to: 4, text: '!' }]],
      {
        edits: [
          { from: 0, to: 0, text: 'R' },
          { from: 3, to: 3, text: '!' },
        ],
      },
    )
    expect(editor.materializeFullText()).toBe('Rabc!')
    expect(publications).toEqual(['published'])
    expect(transactions).toHaveLength(0)
    expect(editor.getState().canUndo).toBe(false)
    expect(scope.getSelections()[0]!.headOffset).toBe(3)
  })

  it('maps every attached view, preserving reversed selections and unchanged interior ranges', () => {
    const buffer = createEditorTextBuffer('abcdef')
    const first = createEditorBufferSession(buffer)
    const second = createEditorBufferSession(buffer)
    first.setSelection(4, 2)
    second.setSelection(3)
    const point = buffer.getDocumentSyncPoint()
    first.reconcile(
      createPieceTableSnapshot('abcdef'),
      [
        [
          { from: 0, to: 0, text: 'R' },
          { from: 6, to: 6, text: '!' },
        ],
      ],
      {
        edits: [
          { from: 0, to: 0, text: 'R' },
          { from: 6, to: 6, text: '!' },
        ],
      },
    )
    expect(
      resolveSelection(first.getSnapshot(), first.getSelections().selections[0]!),
    ).toMatchObject({ anchorOffset: 5, headOffset: 3 })
    expect(
      resolveSelection(second.getSnapshot(), second.getSelections().selections[0]!),
    ).toMatchObject({ headOffset: 4 })
    expect(buffer.changesSinceDocumentSyncPoint(point, null)?.edits).toEqual([
      { from: 0, to: 0, text: 'R' },
      { from: 6, to: 6, text: '!' },
    ])
    expect(buffer.getHistoryGraph().nodes).toHaveLength(1)
  })

  it('publishes snapshot replacement even when visible text is unchanged and resets only an expired consumer', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    const expired = buffer.getDocumentSyncPoint()
    for (let index = 0; index < 129; index++)
      session.applyEdits([{ from: 0, to: 0, text: 'x' }], { history: 'skip' })
    const current = buffer.getDocumentSyncPoint()
    const events: unknown[] = []
    buffer.subscribe((event) => events.push(event))
    session.reconcile(createPieceTableSnapshot(session.materializeFullText()), [], { edits: [] })
    expect(events).toHaveLength(1)
    expect(buffer.changesSinceDocumentSyncPoint(current, null)?.edits).toEqual([])
    expect(buffer.changesSinceDocumentSyncPoint(expired, null)).toBeNull()
  })

  it('keeps existing undo graph entries and rejects reentrant mutation leases', () => {
    const session = createDocumentSession('abc')
    session.applyEdits([{ from: 1, to: 1, text: 'L' }])
    const buffer = (session as ReturnType<typeof createEditorBufferSession>).buffer
    const before = buffer.getHistoryGraph()
    session.reconcile(
      createPieceTableSnapshot('abc'),
      [[{ from: 0, to: 0, text: 'R' }], [{ from: 2, to: 2, text: 'L' }]],
      { edits: [{ from: 0, to: 0, text: 'R' }] },
    )
    expect(buffer.getHistoryGraph().nodes.map((node) => node.id)).toEqual(
      before.nodes.map((node) => node.id),
    )
    expect(buffer.getHistoryGraph().currentId).toBe(before.currentId)
    const leased = acquireDocumentMutationLease(
      buffer,
      buffer.getRevision(),
      buffer.getSnapshot(),
      'test',
    )
    expect(leased.status).toBe('acquired')
    expect(
      session.reconcile(createPieceTableSnapshot('blocked'), [], {
        edits: [{ from: 0, to: 5, text: 'blocked' }],
      }).kind,
    ).toBe('none')
    expect(session.materializeFullText()).toBe('RaLbc')
    if (leased.status === 'acquired') releaseDocumentMutationLease(buffer, leased.lease)
  })
})
