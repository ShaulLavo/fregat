import { expect, it } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer, acquireDocumentMutationLease, rotateDocumentSyncSegment, releaseDocumentMutationLease } from '../src/documentSession'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import { defineDocumentOperation } from '../src/editor/operationDefinitions'
import type { DocumentProjectionEndpoint, DocumentProjectionUpdate } from '../src/editor/documentDelivery'
import type { EditorViewContributionContext, EditorPlugin } from '../src/plugins'
import { createVisibleEditor } from './factories/visibleEditor'

it('binds projected source to canonical acknowledged base reads and retires the final view interest', async () => {
  const buffer = createEditorTextBuffer('one\ntwo\nthree')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'projection' })
  const updates: DocumentProjectionUpdate[] = []
  let registrations = 0
  let released = 0
  const connection = {
    generation: 1,
    nextRegistration: () => ++registrations,
    admit: async (update: DocumentProjectionUpdate) => { updates.push(update); return { kind: 'applied' as const, identity: update.identity, base: update.base, target: update.target } },
    release: () => { released++ },
  }
  const endpoint: DocumentProjectionEndpoint = { connect: async () => connection }
  let disposed = 0
  const operation = defineDocumentOperation((_context, _input: string) => ({
    analyze: async read => {
      const receipt = await _context.source.prepareProjection(endpoint, read)
      return receipt?.target.revision ?? -1
    },
    dispose: () => { disposed++ },
  }), (left, right) => left === right)
  const first = analysis.contributions.retain(operation, 'view')!
  const peer = analysis.contributions.retain(operation, 'view')!
  expect(first.runtimeSessionId).toBe(peer.runtimeSessionId)
  expect(await first.request()).toBe(0)
  expect(updates[0].baseRead).toBeNull()
  const before = updates[0].read
  view.applyText('!')
  expect(await peer.request()).toBe(1)
  expect(updates[1].baseRead).toBe(before)
  expect(updates[1].baseRead?.text.readRange(0, before.text.length)).toBe('one\ntwo\nthree')
  expect(updates[1].changes?.edits?.length).toBeGreaterThan(0)
  first.dispose()
  expect(disposed).toBe(0)
  peer.dispose()
  expect(disposed).toBe(1)
  expect(released).toBe(1)
  const reopened = analysis.contributions.retain(operation, 'view')!
  expect(reopened.runtimeSessionId).not.toBe(first.runtimeSessionId)
  await reopened.request()
  expect(updates[2].baseRead).toBeNull()
  reopened.dispose()
  expect(disposed).toBe(2)
  analysis.dispose()
})

it('provides the current receiver to simple and shared views and rebinds on document replacement', () => {
  const contexts: EditorViewContributionContext[] = []
  const observed: unknown[] = []
  const plugin: EditorPlugin = {
    activate: context => context.registerViewContribution({
      createContribution: view => {
        contexts.push(view)
        return { update: () => { observed.push(view.getDocumentContributions()) }, dispose: () => {} }
      },
    }),
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createVisibleEditor(host, { defaultText: 'simple', plugins: [plugin] })
  const context = contexts[0]
  const simple = context.getDocumentContributions()
  expect(simple).not.toBeNull()
  editor.setText('replacement')
  expect(context.getDocumentContributions()).not.toBe(simple)
  expect(observed).toContain(context.getDocumentContributions())
  const buffer = createEditorTextBuffer('shared')
  const shared = createEditorDocumentAnalysis({ buffer, documentId: 'shared' })
  editor.attachSession(createEditorBufferSession(buffer), { analysis: shared })
  expect(context.getDocumentContributions()).toBe(shared.contributions)
  editor.clear()
  expect(context.getDocumentContributions()).toBeNull()
  editor.dispose()
  shared.dispose()
  host.remove()
})

it('keeps static sources canonical through programmatic updates, no-ops and replacement', async () => {
  const contexts: EditorViewContributionContext[] = []
  const plugin: EditorPlugin = { activate: context => context.registerViewContribution({ createContribution: view => {
    contexts.push(view)
    return { update: () => {}, dispose: () => {} }
  } }) }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = createVisibleEditor(host, { defaultText: 'old😀\r\nline', documentMode: 'static', plugins: [plugin] })
  const session = editor.getBufferSession()!
  const buffer = session.buffer
  expect(editor.getSelections()[0]).toMatchObject({ anchorOffset: 10, headOffset: 10, affinity: 'after' })
  const old = buffer.getTextSnapshot()
  const point = buffer.getDocumentSyncPoint()
  const changes: ReturnType<typeof buffer.getDocumentSyncPoint>[] = []
  const unsubscribe = buffer.subscribe(event => {
    expect(event.change.canUndo).toBe(false)
    expect(event.change.canRedo).toBe(false)
    expect(event.change.isDirty).toBe(false)
    expect(event.change.logicalRevisionCount).toBe(1)
    changes.push(event.syncPointAfter)
  })
  const operation = defineDocumentOperation(context => ({
    analyze: async read => ({ read, delta: context.source.changesBetween(context.initialRead.revision, read.revision) }),
    dispose: () => {},
  }), () => true)
  const receiver = contexts[0].getDocumentContributions()!
  const lease = receiver.retain(operation, null)!
  const initial = await lease.request()
  expect(initial.read.text.readRange(0, initial.read.text.length)).toBe('old😀\nline')
  editor.edit({ from: 0, to: 3, text: 'blocked' })
  session.applyText('blocked')
  session.indentSelection('  ')
  session.outdentSelection(2)
  session.backspace()
  session.deleteSelection()
  session.undo()
  session.redo()
  expect(buffer.getDocumentSyncPoint()).toBe(point)
  editor.syncText('new😀\r\nline', { documentMode: 'static' })
  expect(changes).toHaveLength(1)
  const current = await lease.request()
  expect(current.read.revision.point.revision).toBe(point.revision + 1)
  expect(current.delta?.logicalRevisionCount).toBe(1)
  expect(current.read.text.readRange(0, current.read.text.length)).toBe('new😀\nline')
  expect(old.readRange(0, old.length)).toBe('old😀\nline')
  expect(session.isDirty()).toBe(false)
  expect(session.canUndo()).toBe(false)
  expect(session.canRedo()).toBe(false)
  expect(buffer.getHistoryGraph().nodes).toHaveLength(1)
  editor.syncText('new😀\r\nline', { documentMode: 'static' })
  expect(changes).toHaveLength(1)
  expect(buffer.getDocumentSyncPoint()).toBe(current.read.revision.point)
  editor.setText('replacement', { documentMode: 'static' })
  expect(contexts[0].getDocumentContributions()).not.toBe(receiver)
  expect(lease.read().kind).toBe('failed')
  lease.dispose()
  unsubscribe()
  editor.dispose()
  host.remove()
})

it('retains projected resources without reading hidden edits and wakes the newest canonical source on demand', async () => {
  const buffer = createEditorTextBuffer('first')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'hidden' })
  let reads = 0
  const operation = defineDocumentOperation(() => ({ analyze: async read => {
    reads++
    return read.text.readRange(0, read.text.length)
  }, dispose: () => {} }), () => true)
  const retained = analysis.contributions.retain(operation, null)!
  expect(reads).toBe(0)
  expect(await retained.request()).toBe('first')
  for (let edit = 0; edit < 10; edit++) createEditorBufferSession(buffer).applyText('!')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(reads).toBe(1)
  expect(await retained.request()).toBe('first!!!!!!!!!!')
  expect(reads).toBe(2)
  retained.dispose(); analysis.dispose()
})

it.each(['ready', 'in-flight'] as const)('rejects an old %s source across a same-revision segment rotation', async phase => {
  const buffer = createEditorTextBuffer('stable')
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'segment' })
  let finish = () => {}
  let start = () => {}
  const started = new Promise<void>(resolve => { start = resolve })
  let runs = 0
  const operation = defineDocumentOperation(() => ({ analyze: async read => {
    runs++
    if (phase === 'in-flight' && runs === 1) { start(); await new Promise<void>(resolve => { finish = resolve }) }
    return read.revision.point
  }, dispose: () => {} }), () => true)
  const retained = analysis.contributions.retain(operation, null)!
  const initial = retained.request()
  const old = buffer.getDocumentSyncPoint()
  if (phase === 'ready') expect(await initial).toBe(old)
  else await started
  const acquired = acquireDocumentMutationLease(buffer, buffer.getRevision(), buffer.getSnapshot(), 'rotation')
  expect(acquired.status).toBe('acquired')
  if (acquired.status !== 'acquired') return
  expect(rotateDocumentSyncSegment(buffer, old, acquired.lease).status).toBe('rotated')
  const current = buffer.getDocumentSyncPoint()
  expect(current.revision).toBe(old.revision)
  expect(current.segment).not.toBe(old.segment)
  if (phase === 'in-flight') {
    const rejection = expect(initial).rejects.toMatchObject({ name: 'AbortError' })
    finish()
    await rejection
  }
  expect(retained.read().kind).toBe('pending')
  expect(await retained.request()).toBe(current)
  expect(runs).toBe(2)
  releaseDocumentMutationLease(buffer, acquired.lease)
  retained.dispose(); analysis.dispose()
})
