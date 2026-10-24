import { expect, test } from 'vitest'
import {
  createEditorTextBuffer,
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
} from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { defineDocumentOperation } from '@singapore-editor/core/internal/document-worker'
import { createInputSourceIdentity } from '../input-worker-proof.mjs'

test('actual opaque rotation rejects the previous encoded segment and admits the current core-issued point', async () => {
  const buffer = createEditorTextBuffer('abc')
  const initial = buffer.getDocumentSyncPoint()
  const guard = createInputSourceIdentity(initial)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'segment-identity' })
  const received = []
  let registration = 0
  const connection = {
    generation: 1,
    nextRegistration: () => ++registration,
    admit: async (update) => {
      const text = update.read.text.readRange(0, update.read.text.length)
      const receipt = {
        kind: 'applied',
        identity: update.identity,
        base: update.base,
        target: update.target,
      }
      received.push({ text, receipt, nativePoint: update.read.revision.point })
      return receipt
    },
    release() {},
  }
  const endpoint = { connect: async () => connection }
  const operation = defineDocumentOperation(
    (context) => ({
      analyze: (read) => context.source.prepareProjection(endpoint, read),
      dispose() {},
    }),
    () => true,
  )
  const lease = analysis.contributions.retain(operation, null)
  try {
    const first = await lease.request()
    expect(received[0].nativePoint.segment).toBe(initial.segment)
    expect(guard.matches(first.identity, first.target, initial)).toBe(true)
    const held = acquireDocumentMutationLease(
      buffer,
      buffer.getRevision(),
      buffer.getSnapshot(),
      'segment-proof',
    )
    expect(held.status).toBe('acquired')
    const rotation = rotateDocumentSyncSegment(buffer, initial, held.lease)
    releaseDocumentMutationLease(buffer, held.lease)
    expect(rotation.status).toBe('rotated')
    const current = buffer.getDocumentSyncPoint()
    expect(current.segment).not.toBe(initial.segment)
    expect(current.revision).toBe(initial.revision)
    expect(current.textVersion).toBe(initial.textVersion)
    expect(buffer.materializeFullText()).toBe('abc')
    expect(guard.matches(first.identity, first.target, current)).toBe(false)
    const next = await lease.request()
    expect(received.at(-1).nativePoint.segment).toBe(current.segment)
    expect(next.target.segment).not.toBe(first.target.segment)
    expect(next.identity.documentId).toBe(first.identity.documentId)
    expect(guard.matches(next.identity, next.target, current)).toBe(true)
    expect(guard.matches(first.identity, first.target, current)).toBe(false)
  } finally {
    lease.dispose()
    analysis.dispose()
  }
})

test('identity association rejects a foreign owner and rotation before the initial source observation', () => {
  const first = createEditorTextBuffer('abc')
  const second = createEditorTextBuffer('abc')
  const initial = first.getDocumentSyncPoint()
  const guard = createInputSourceIdentity(initial)
  const identity = {
    documentId: 'observed-owner',
    documentGeneration: 1,
    endpointGeneration: 1,
    registrationId: 1,
  }
  const wire = {
    segment: 'observed-wire',
    revision: initial.revision,
    textVersion: initial.textVersion,
  }
  expect(guard.matches(identity, wire, second.getDocumentSyncPoint())).toBe(false)
  expect(guard.matches(identity, wire, initial)).toBe(true)
  expect(guard.matches({ ...identity, documentId: 'other-owner' }, wire, initial)).toBe(false)
})
