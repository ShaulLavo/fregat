import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '../src/editor/Editor'
import { createPlugin, type EditorViewScope } from '../src/createPlugin'
import {
  createDocumentSession,
  createEditorTextBuffer,
  createEditorBufferSession,
  createPieceTableSnapshot,
  materializePieceTableFullText,
  type EditorTextTransaction,
} from '../src/public/document'
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
function mount(text = 'abc', options: ConstructorParameters<typeof Editor>[1] = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const events: EditorTextTransaction[] = []
  let scope!: EditorViewScope
  let recording!: ReturnType<EditorViewScope['onDidTransaction']>
  const editor = new Editor(host, {
    defaultText: text,
    ...options,
    plugins: (options.plugins ?? []).concat([
      createPlugin({
        name: 'review',
        view(api) {
          scope = api
          recording = api.onDidTransaction((e) => events.push(e))
        },
      }),
    ]),
  })
  editors.push(editor)
  return { editor, scope, events, recording }
}
const transitions = (events: readonly EditorTextTransaction[]) =>
  events.map((e) => [
    materializePieceTableFullText(e.snapshotBefore),
    materializePieceTableFullText(e.snapshotAfter),
  ])

test('original reproduction: attached-session edit precedes callback replacement', () => {
  let editor!: Editor
  let armed = false
  const m = mount('abc', {
    onChange(_state, change) {
      if (!armed || change?.kind !== 'edit') return
      armed = false
      editor.setText('second')
    },
  })
  editor = m.editor
  const session = createDocumentSession('abc')
  editor.attachSession(session)
  armed = true
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(m.events)).toEqual([
    ['abc', 'axbc'],
    ['axbc', 'second'],
  ])
})
test('original reproduction: both nested setText transitions retain their snapshots', () => {
  let editor!: Editor
  let armed = false
  const m = mount('abc', {
    onChange() {
      if (!armed) return
      armed = false
      editor.setText('second')
    },
  })
  editor = m.editor
  armed = true
  editor.setText('first')
  expect(transitions(m.events)).toEqual([
    ['abc', 'first'],
    ['first', 'second'],
  ])
})

test('a pre-view buffer observer swaps sessions without stranding the captured commit', () => {
  const first = createEditorBufferSession(createEditorTextBuffer('abc'))
  const next = createDocumentSession('next')
  let editor!: Editor
  const subscription = first.buffer.subscribe(() => editor.attachSession(next))
  const m = mount()
  editor = m.editor
  editor.attachSession(first)
  first.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(editor.materializeFullText()).toBe('next')
  const pending = Reflect.get(editor, 'pendingTransactions') as {
    ready: boolean
    event: EditorTextTransaction
  }[]
  expect.soft(transitions(m.events)).toEqual([['abc', 'axbc']])
  expect(pending.length).toBe(0)
  subscription()
})

test('a pre-view buffer observer detaches without stranding the captured commit', () => {
  const first = createEditorBufferSession(createEditorTextBuffer('abc'))
  let editor!: Editor
  const subscription = first.buffer.subscribe(() => editor.detachSession())
  const m = mount()
  editor = m.editor
  editor.attachSession(first)
  first.applyEdits([{ from: 1, to: 1, text: 'x' }])
  const pending = Reflect.get(editor, 'pendingTransactions') as {
    ready: boolean
    event: EditorTextTransaction
  }[]
  expect.soft(transitions(m.events)).toEqual([['abc', 'axbc']])
  expect(pending.length).toBe(0)
  subscription()
})

test('shared views receive the same FIFO across a reentrant edit', () => {
  const session = createDocumentSession('abc'),
    a = mount(),
    b = mount()
  a.editor.attachSession(session)
  b.editor.attachSession(session)
  let armed = true
  a.scope.onDidTransaction(() => {
    if (!armed) return
    armed = false
    a.scope.applyEdits([{ from: 2, to: 2, text: 'y' }])
  })
  a.scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(a.events)).toEqual([
    ['abc', 'axbc'],
    ['axbc', 'axybc'],
  ])
  expect(transitions(b.events)).toEqual(transitions(a.events))
  expect((Reflect.get(a.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
  expect((Reflect.get(b.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
})

test('view replacement during a shared commit preserves its earlier captured commits', () => {
  const session = createDocumentSession('abc'),
    a = mount(),
    b = mount()
  a.editor.attachSession(session)
  b.editor.attachSession(session)
  let armed = true
  a.scope.onDidTransaction(() => {
    if (!armed) return
    armed = false
    a.scope.applyEdits([{ from: 2, to: 2, text: 'y' }])
    b.editor.setText('replacement')
  })
  a.scope.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(a.events)).toEqual([
    ['abc', 'axbc'],
    ['axbc', 'axybc'],
  ])
  expect(transitions(b.events)).toEqual([
    ['abc', 'axbc'],
    ['axbc', 'axybc'],
    ['axybc', 'replacement'],
  ])
  expect((Reflect.get(b.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
})

test('queue releases snapshots when the editor is disposed before view acceptance', () => {
  const first = createEditorBufferSession(createEditorTextBuffer('abc'))
  let editor!: Editor
  const subscription = first.buffer.subscribe(() => editor.dispose())
  const m = mount()
  editor = m.editor
  editor.attachSession(first)
  first.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect((Reflect.get(editor, 'pendingTransactions') as unknown[]).length).toBe(0)
  subscription()
})

test('missing reconcile edits reject all runtime entry points atomically', () => {
  const m = mount('abc'),
    session = createEditorBufferSession(createEditorTextBuffer('abc')),
    base = createPieceTableSnapshot('xyz')
  const before = session.getSnapshot()
  const callables = [
    (options: unknown) => Reflect.apply(session.reconcile, session, [base, [], options]),
    (options: unknown) =>
      Reflect.apply(session.buffer.reconcile, session.buffer, [base, [], options]),
    (options: unknown) => Reflect.apply(m.editor.reconcile, m.editor, [base, [], options]),
    (options: unknown) => Reflect.apply(m.scope.reconcile, m.scope, [base, [], options]),
  ]
  for (const call of callables)
    for (const options of [undefined, {}, null]) {
      expect(() => call(options)).toThrowError(
        expect.objectContaining({ code: 'EDITOR_RECONCILE_EDITS_REQUIRED' }),
      )
      expect(session.getSnapshot()).toBe(before)
      expect(session.materializeFullText()).toBe('abc')
      expect(m.editor.materializeFullText()).toBe('abc')
    }
  expect(m.events).toHaveLength(0)
})

test('a fully subscribed view drains its pending snapshots after many commits', () => {
  const m = mount()
  for (let i = 0; i < 1000; i++)
    m.scope.applyEdits([{ from: 0, to: 0, text: 'x' }], undefined, { history: 'skip' })
  expect(m.events).toHaveLength(1000)
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
})

test('successive pre-acceptance document swaps have bounded queued snapshot retention', () => {
  const m = mount()
  for (let i = 0; i < 100; i++) {
    const session = createEditorBufferSession(createEditorTextBuffer(`document-${i}`))
    const off = session.buffer.subscribe(() => m.editor.detachSession())
    m.editor.attachSession(session)
    session.applyEdits([{ from: 0, to: 0, text: 'x' }])
    off()
  }
  expect(m.events).toHaveLength(100)
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
})

test('another view onChange can attach a document without stranding this view transaction', () => {
  const session = createDocumentSession('abc'),
    next = createDocumentSession('next')
  let armed = false,
    b: ReturnType<typeof mount>
  const a = mount('abc', {
    onChange(_state, change) {
      if (!armed || change?.kind !== 'edit') return
      armed = false
      b.editor.attachSession(next)
    },
  })
  b = mount()
  a.editor.attachSession(session)
  b.editor.attachSession(session)
  armed = true
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(a.events)).toEqual([['abc', 'axbc']])
  expect(b.editor.materializeFullText()).toBe('next')
  expect(transitions(b.events)).toEqual(transitions(a.events))
})

type AttachmentQueue = {
  readonly pending: ReadonlySet<unknown>
  readonly pendingByChange: ReadonlyMap<unknown, unknown>
}

function attachmentQueue(editor: Editor): AttachmentQueue {
  return Reflect.get(editor, 'transactionAttachment') as AttachmentQueue
}

function expectReleased(attachment: AttachmentQueue) {
  expect(attachment.pending.size).toBe(0)
  expect(attachment.pendingByChange.size).toBe(0)
}

test.each(['clear', 'open'] as const)('a pre-view %s drains the outgoing attachment', (action) => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const m = mount()
  const off = session.buffer.subscribe(() => {
    if (action === 'clear') m.editor.clearDocument()
    else m.editor.openDocument({ text: 'next' })
  })
  m.editor.attachSession(session)
  const outgoing = attachmentQueue(m.editor)
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(m.events)).toEqual([['abc', 'axbc']])
  expect(m.editor.materializeFullText()).toBe(action === 'clear' ? '' : 'next')
  expectReleased(outgoing)
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
  off()
})

test('removing the final listener drops pending snapshots before a new subscription', () => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const m = mount()
  const off = session.buffer.subscribe(() => m.recording.dispose())
  m.editor.attachSession(session)
  const outgoing = attachmentQueue(m.editor)
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(m.events).toHaveLength(0)
  expectReleased(outgoing)
  expect(Reflect.get(m.editor, 'transactionAttachment')).toBeNull()
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
  off()
  const next: EditorTextTransaction[] = []
  m.scope.onDidTransaction((event) => next.push(event))
  session.applyEdits([{ from: 2, to: 2, text: 'y' }])
  expect(transitions(next)).toEqual([['axbc', 'axybc']])
  expectReleased(attachmentQueue(m.editor))
})

test('removing one listener preserves the captured commit for remaining subscribers', () => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const m = mount()
  const off = session.buffer.subscribe(() => m.recording.dispose())
  m.editor.attachSession(session)
  const seen: EditorTextTransaction[] = []
  m.scope.onDidTransaction((event) => seen.push(event))
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(m.events).toHaveLength(0)
  expect(transitions(seen)).toEqual([['abc', 'axbc']])
  expectReleased(attachmentQueue(m.editor))
  off()
})

test('disposal during delivery drops queued edits and stops remaining listeners', () => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const m = mount()
  m.editor.attachSession(session)
  const outgoing = attachmentQueue(m.editor)
  m.editor.onDidTransaction(() => {
    session.applyEdits([{ from: 2, to: 2, text: 'y' }])
    m.editor.dispose()
  })
  const late: EditorTextTransaction[] = []
  m.editor.onDidTransaction((event) => late.push(event))
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(m.events)).toEqual([['abc', 'axbc']])
  expect(late).toHaveLength(0)
  expectReleased(outgoing)
  expect(Reflect.get(m.editor, 'transactionAttachment')).toBeNull()
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
})

test('a disposed editor accepts no new transaction subscription', () => {
  const m = mount()
  m.editor.dispose()
  const late = m.editor.onDidTransaction(() => {})
  expect(Reflect.get(m.editor, 'transactionListeners').size).toBe(0)
  expect(Reflect.get(m.editor, 'transactionAttachment')).toBeNull()
  late.dispose()
})

test('reattaching the same session retires the old attachment exactly once', () => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const m = mount()
  const off = session.buffer.subscribe(() => m.editor.attachSession(session))
  m.editor.attachSession(session)
  const outgoing = attachmentQueue(m.editor)
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  session.applyEdits([{ from: 2, to: 2, text: 'y' }])
  expect(transitions(m.events)).toEqual([
    ['abc', 'axbc'],
    ['axbc', 'axybc'],
  ])
  expect(attachmentQueue(m.editor)).not.toBe(outgoing)
  expectReleased(outgoing)
  expectReleased(attachmentQueue(m.editor))
  off()
})

test('a surviving listener can edit the new attachment while the old commit drains', () => {
  const session = createEditorBufferSession(createEditorTextBuffer('abc'))
  const next = createDocumentSession('next')
  const m = mount()
  const off = session.buffer.subscribe(() => m.editor.attachSession(next))
  m.editor.attachSession(session)
  const outgoing = attachmentQueue(m.editor)
  m.scope.onDidTransaction((event) => {
    if (event.edits[0]?.text !== 'x') return
    next.applyEdits([{ from: 4, to: 4, text: '!' }])
  })
  session.applyEdits([{ from: 1, to: 1, text: 'x' }])
  expect(transitions(m.events)).toEqual([
    ['abc', 'axbc'],
    ['next', 'next!'],
  ])
  expect(m.editor.materializeFullText()).toBe('next!')
  expectReleased(outgoing)
  expectReleased(attachmentQueue(m.editor))
  expect((Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length).toBe(0)
  off()
})
