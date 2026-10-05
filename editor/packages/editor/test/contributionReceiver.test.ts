import { expect, it } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
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
