import '../src/presence.css'
import { afterEach, expect, test } from 'vitest'
import { commands, page } from 'vitest/browser'
import { Editor } from '@singapore-editor/core/editor'
import { createPlugin, textInput, type EditorViewScope } from '@singapore-editor/core/extensions'
import { EditorRoom } from './editor-fixture'
import { createCollaborationPlugin } from '../src/plugin'

declare module 'vitest/browser' {
  interface BrowserCommands {
    editorType(text: string): Promise<void>
    editorIME(text: string, commit: boolean): Promise<void>
    editorPaste(text: string): Promise<void>
    editorLook(label: string): Promise<void>
    editorExperiment(data: unknown): Promise<void>
  }
}

let room: EditorRoom | undefined
const standalone: Editor[] = []
afterEach(() => {
  room?.dispose()
  room = undefined
  for (const editor of standalone.splice(0)) editor.dispose()
  document.body.replaceChildren()
})

function converged(expected?: string): void {
  const texts = room!.texts()
  expect(new Set(texts).size).toBe(1)
  if (expected !== undefined) expect(texts[0]).toBe(expected)
  for (const index of room!.alive)
    expect(room!.connections[index]!.document.participant.state().pending).toEqual([])
}

for (const count of [2, 3]) {
  for (const direction of ['forward', 'backward'] as const) {
    test(`${count} simple editors preserve concurrent ${direction} runs and author undo`, async () => {
      room = new EditorRoom(count, 'seed')
      expect(room.connections.every(({ session }) => session.status === 'stable')).toBe(true)
      const runs = ['abc', 'xyz', '123'].slice(0, count)
      for (let unit = 0; unit < 3; unit++) {
        for (let index = 0; index < count; index++)
          room.editors[index]!.edit({
            from: direction === 'forward' ? 4 + unit : 0,
            to: direction === 'forward' ? 4 + unit : 0,
            text: runs[index]![direction === 'forward' ? unit : 2 - unit]!,
          })
      }
      room.flush()
      converged()
      for (const run of runs) expect(room.texts()[0]).toContain(run)
      for (let index = 0; index < count; index++) {
        room.editors[index]!.dispatchCommand('undo')
        room.flush()
        converged()
        expect(room.texts()[0]).not.toContain(runs[index])
        for (let other = index + 1; other < count; other++)
          expect(room.texts()[0]).toContain(runs[other])
      }
      converged('seed')
      for (let index = 0; index < count; index++) {
        room.editors[index]!.dispatchCommand('redo')
        room.flush()
        converged()
        expect(room.texts()[0]).toContain(runs[index])
      }
      if (count === 2) await commands.editorLook(`two-editors-${direction}`)
    })
  }
}

test('the binding publishes identity-based selections and renders peer labels', async () => {
  room = new EditorRoom(2, 'word', true)
  room.editors[0]!.focus()
  room.editors[0]!.setSelection(1, 3)
  room.flush()
  await expect.element(page.getByText('Peer 0', { exact: true })).toBeVisible()
  expect(room.connections[1]!.presence!.states[0]!.selections).toHaveLength(1)
  room.editors[1]!.edit({ from: 0, to: 0, text: 'new ' })
  room.flush()
  converged('new word')
  await commands.editorLook('bound-presence')
  room.editors[0]!.setPlugins([])
  room.flush()
  expect(room.connections[1]!.presence!.states).toEqual([])
  await expect.poll(() => room!.host.querySelectorAll('.editor-remote-name').length).toBe(0)
})

test('native typing, IME composition and paste settle without echoed transactions', async () => {
  room = new EditorRoom(2)
  const transactions: string[][] = [[], []]
  room.editors.forEach((editor, index) =>
    editor.onDidTransaction((event) => transactions[index]!.push(event.origin)),
  )
  room.editors[0]!.focus()
  await commands.editorType('hello')
  room.editors[1]!.edit({ from: 0, to: 0, text: 'peer' })
  room.flush()
  converged()
  expect(room.texts()[0]).toContain('hello')
  expect(room.texts()[0]).toContain('peer')
  room.editors[0]!.setSelection(room.editors[0]!.getState().length)
  room.editors[0]!.focus()
  const beforeComposition = transactions[0]!.length
  await commands.editorIME('日本', false)
  expect(transactions[0]).toHaveLength(beforeComposition)
  room.editors[1]!.edit({ from: 0, to: 0, text: 'remote' })
  room.flush()
  await commands.editorIME('日本', true)
  expect(transactions[0]).toHaveLength(beforeComposition + 1)
  room.flush()
  converged()
  expect(room.texts()[0]).toContain('日本')
  room.editors[1]!.focus()
  await commands.editorPaste('\npasted 😀')
  room.flush()
  converged()
  expect(room.texts()[0]).toContain('pasted 😀')
  expect(transactions.flat().every((origin) => origin === 'local' || origin === 'view')).toBe(true)
})

test('host handoff during concurrent input retains pending text and author-selective history', () => {
  room = new EditorRoom(3)
  room.editors[0]!.edit({ from: 0, to: 0, text: 'host' })
  room.editors[1]!.edit({ from: 0, to: 0, text: 'successor' })
  room.editors[2]!.edit({ from: 0, to: 0, text: 'third' })
  room.connections[0]!.session.leave('peer-1')
  room.flush(30)
  expect(room.connections[0]!.session.status).toBe('left')
  room.remove(0)
  room.flush(20)
  expect(room.connections[1]!.session.host).toBe('peer-1')
  converged()
  for (const text of ['host', 'successor', 'third']) expect(room.texts()[0]).toContain(text)
  room.editors[1]!.dispatchCommand('undo')
  room.flush()
  converged()
  expect(room.texts()[0]).not.toContain('successor')
  expect(room.texts()[0]).toContain('third')
  expect(room.texts()[0]).toContain('host')
})

test('remote edits publish to syntax and tracked decorations and map selections', async () => {
  room = new EditorRoom(2, 'word')
  let scope!: EditorViewScope
  let updates = 0
  const observer = createPlugin({
    name: 'test.consumer',
    view(api) {
      scope = api
    },
  })
  room.editors[1]!.addPlugin(observer)
  const range = scope.view.trackRanges([{ start: 0, end: 4 }])
  const registration = scope.view.onDidTransaction(() => {
    updates++
  })
  room.editors[1]!.setSelection(2)
  room.editors[1]!.setTokens([{ start: 0, end: 4, style: { color: '#ff8844' } }])
  scope.watch(textInput, () => {
    room!.editors[1]!.setRangeDecorations(
      range
        .resolve()
        .map(({ start, end }) => ({ start, end, style: { backgroundColor: '#444477' } })),
    )
  })
  const version = scope.view.getSnapshot().textVersion
  room.editors[0]!.edit({ from: 0, to: 0, text: 'new ' })
  room.flush()
  converged('new word')
  expect(scope.view.getSnapshot().textVersion).toBeGreaterThan(version)
  expect(range.resolve()).toEqual([{ start: 4, end: 8 }])
  expect(scope.getSelections()[0]).toMatchObject({ anchorOffset: 6, headOffset: 6 })
  expect(updates).toBe(0)
  registration.dispose()
  await commands.editorLook('remote-consumers')
})

test('detaching starts native history from the merged text and leaves snapshots editable', () => {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor(element, { defaultText: 'seed' })
  standalone.push(editor)
  editor.edit({ from: 4, to: 4, text: 'own' })
  const plugin = createCollaborationPlugin({
    session: { peer: 'only', room: 'detach', document: 'detach', epoch: 'detach', text: 'seedown' },
    transport: { send() {} },
    manualClock: true,
  })
  editor.addPlugin(plugin)
  const states = editor.getBufferSession()!.buffer.getHistoryGraph().retainedStates
  editor.edit({ from: 7, to: 7, text: 'session' })
  expect(editor.getBufferSession()!.buffer.getHistoryGraph().retainedStates).toBe(states)
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('seedown')
  editor.removePlugin(plugin)
  expect(editor.getState().canUndo).toBe(false)
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('seedown')
  editor.edit({ from: 7, to: 7, text: 'resumed' })
  expect(editor.materializeFullText()).toBe('seedownresumed')
  editor.dispatchCommand('undo')
  expect(editor.materializeFullText()).toBe('seedown')
})

test('switching documents releases collaborative commands and preserves native history', () => {
  room = new EditorRoom(2, 'shared')
  room.editors[0]!.openDocument({ documentId: 'separate', text: 'own' })
  room.editors[0]!.edit({ from: 3, to: 3, text: ' history' })
  room.editors[0]!.dispatchCommand('undo')
  expect(room.editors[0]!.getTextSnapshot().materializeFullText()).toBe('own')
  room.editors[1]!.edit({ from: 6, to: 6, text: ' remote' })
  room.flush()
  expect(room.editors[0]!.getTextSnapshot().materializeFullText()).toBe('own')
  room.editors[0]!.dispatchCommand('redo')
  expect(room.editors[0]!.getTextSnapshot().materializeFullText()).toBe('own history')
  expect(room.connections[0]!.session.status).toBe('left')
  expect(room.connections[0]!.document.engine.text()).toBe('shared')
  expect(room.connections[1]!.document.engine.text()).toBe('shared remote')
})

test('unattached collaboration and inert extensions leave native history and typing untouched', () => {
  for (const count of [0, 100, 1000]) {
    const element = document.createElement('div')
    document.body.append(element)
    let callbacks = 0
    const plugins = Array.from({ length: count }, (_, index) => ({
      name: `inert-${index}`,
      activate() {
        callbacks++
        return []
      },
    }))
    const editor = new Editor(element, { plugins })
    standalone.push(editor)
    callbacks = 0
    editor.edit({ from: 0, to: 0, text: 'own' })
    editor.dispatchCommand('undo')
    expect(editor.getTextSnapshot().materializeFullText()).toBe('')
    editor.dispatchCommand('redo')
    expect(editor.getTextSnapshot().materializeFullText()).toBe('own')
    expect(callbacks).toBe(0)
  }
})

declare const __COLLABORATION_MEASURE__: boolean

test.skipIf(!__COLLABORATION_MEASURE__)(
  'experiment counts per-keystroke work solo and during concurrent peer typing in ABBA order',
  async () => {
    const results: unknown[] = []
    for (const mode of ['solo', 'concurrent', 'concurrent', 'solo']) {
      const fixture = new EditorRoom(mode === 'solo' ? 1 : 2, 'seed')
      let reconciles = 0
      let authored = 0
      let publications = 0
      for (const editor of fixture.editors) {
        const reconcile = editor.reconcile.bind(editor)
        editor.reconcile = (...args) => {
          reconciles++
          reconcile(...args)
        }
        editor.onDidTransaction(() => authored++)
      }
      const disposals = fixture.connections.map(({ document }) =>
        document.participant.subscribe(() => publications++),
      )
      const times: number[] = []
      const counts: unknown[] = []
      for (let key = 0; key < 100; key++) {
        reconciles = 0
        authored = 0
        publications = 0
        const start = performance.now()
        fixture.editors[0]!.edit({ from: key, to: key, text: 'a' })
        if (mode === 'concurrent') fixture.editors[1]!.edit({ from: key, to: key, text: 'b' })
        times.push(performance.now() - start)
        fixture.flush(3)
        counts.push({ authored, reconciles, publications })
      }
      expect(new Set(fixture.texts()).size).toBe(1)
      const sorted = times.sort((a, b) => a - b)
      results.push({
        mode,
        keys: 100,
        counts,
        synchronousAuthorP50Ms: sorted[50],
        synchronousAuthorP95Ms: sorted[95],
        synchronousAuthorMaxMs: sorted.at(-1),
      })
      for (const dispose of disposals) dispose()
      fixture.dispose()
    }
    await commands.editorExperiment({
      label: 'experiment, shared machine',
      method:
        'Counted transaction publications and atomic reconciles per keystroke; synchronous author timings exclude transport and paint. The existing input bench drives one editor.',
      typingBudgetMs: 8.3,
      results,
    })
  },
)
