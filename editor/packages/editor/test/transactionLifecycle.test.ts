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
  const editor = new Editor(host, {
    defaultText: text,
    ...options,
    plugins: [
      ...(options.plugins ?? []),
      createPlugin({
        name: 'review',
        view(api) {
          scope = api
          api.onDidTransaction((e) => events.push(e))
        },
      }),
    ],
  })
  editors.push(editor)
  return { editor, scope, events, host }
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
  console.log(
    'review-queue',
    JSON.stringify({
      count: pending.length,
      ready: pending.map((e) => e.ready),
      snapshots: transitions(pending.map((e) => e.event)),
    }),
  )
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
  console.log(
    'review-queue',
    JSON.stringify({
      count: pending.length,
      ready: pending.map((e) => e.ready),
      snapshots: transitions(pending.map((e) => e.event)),
    }),
  )
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
  console.log(
    'review-retention',
    JSON.stringify({
      delivered: m.events.length,
      queued: (Reflect.get(m.editor, 'pendingTransactions') as unknown[]).length,
    }),
  )
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
