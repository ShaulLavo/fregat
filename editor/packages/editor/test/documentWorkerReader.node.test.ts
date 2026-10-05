import { describe, expect, it } from 'vitest'
import { pieceTableDocumentText } from '@singapore-editor/textbuffer'
import {
  DocumentWorkerReader,
  type DocumentWorkerIdentity,
  type DocumentWorkerPoint,
  type DocumentWorkerSourceCommand,
} from '../src/document/workerReader'

const identity: DocumentWorkerIdentity = {
  documentId: 'document',
  documentGeneration: 1,
  endpointGeneration: 1,
  registrationId: 1,
}
const point = (revision: number): DocumentWorkerPoint => ({
  segment: 'opaque-segment',
  revision,
  textVersion: revision,
})
const reset = (
  chunks: readonly string[],
  target = point(0),
  base: DocumentWorkerPoint | null = null,
  owner = identity,
): Extract<DocumentWorkerSourceCommand, { kind: 'reset' }> => ({
  kind: 'reset',
  identity: owner,
  base,
  target,
  chunks,
  lineEnding: '\r\n',
  byteOrderMark: '\ufeff',
  containsUnusualLineTerminators: false,
})

describe('ordinary worker document reader', () => {
  it('reconstructs chunk-split UTF-16 and preserves serialization metadata', () => {
    const reader = new DocumentWorkerReader()
    reader.apply({ kind: 'register', identity })
    expect(reader.apply(reset(['A\ud83d', '\ude00', '\nB\ud800']))).toMatchObject({
      kind: 'applied',
    })
    const read = reader.acquire({ identity, point: point(0) })!
    expect(read.text.readRange(0, read.text.length)).toBe('A😀\nB\ud800')
    expect(read.text.lineCount).toBe(2)
    expect(pieceTableDocumentText(read.text.snapshot)).toBe('\ufeffA😀\r\nB\ud800')
    read.dispose()
    reader.dispose()
    expect(reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })

  it('holds an old exact read through incremental changes and a forward reset', () => {
    const reader = new DocumentWorkerReader()
    reader.apply({ kind: 'register', identity })
    reader.apply(reset(['left😀\n', 'middle untouched', '\nright']))
    const old = reader.acquire({ identity, point: point(0) })!
    const before = old.text.readRange(0, old.text.length)
    expect(
      reader.apply({
        kind: 'advance',
        identity,
        base: point(0),
        target: point(1),
        edits: [
          { from: 0, to: 0, text: 'L' },
          { from: before.length, to: before.length, text: 'R' },
        ],
      }),
    ).toMatchObject({ kind: 'applied' })
    expect(old.text.readRange(0, old.text.length)).toBe(before)
    expect(reader.apply(reset(['replacement'], point(2), point(1)))).toMatchObject({
      kind: 'applied',
    })
    expect(old.isValid()).toBe(true)
    expect(old.text.readRange(0, old.text.length)).toBe(before)
    const sameOld = reader.acquire({ identity, point: point(0) })!
    expect(sameOld.text.readRange(0, sameOld.text.length)).toBe(before)
    old.dispose()
    sameOld.dispose()
    expect(reader.acquire({ identity, point: point(0) })).toBeNull()
    reader.dispose()
  })

  it('rejects wrong bases and backward resets without changing current text', () => {
    const reader = new DocumentWorkerReader()
    reader.apply({ kind: 'register', identity })
    reader.apply(reset(['current'], point(4)))
    expect(
      reader.apply({ kind: 'advance', identity, base: point(3), target: point(5), edits: [] }),
    ).toMatchObject({ kind: 'rejected', reason: 'base' })
    expect(reader.apply(reset(['old'], point(3), point(4)))).toMatchObject({
      kind: 'rejected',
      reason: 'unavailable',
    })
    const current = reader.acquire({ identity, point: point(4) })!
    expect(current.text.readRange(0, current.text.length)).toBe('current')
    reader.dispose()
    expect(current.isValid()).toBe(false)
    expect(reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })

  it('invalidates old generation loans and remains terminal after disposal', () => {
    const reader = new DocumentWorkerReader()
    reader.apply({ kind: 'register', identity })
    reader.apply(reset(['original']))
    const old = reader.acquire({ identity, point: point(0) })!
    const replacement = { ...identity, documentGeneration: 2, registrationId: 2 }
    reader.apply({ kind: 'register', identity: replacement })
    reader.apply(reset(['new'], point(0), null, replacement))
    expect(old.isValid()).toBe(false)
    expect(reader.acquire({ identity, point: point(0) })).toBeNull()
    expect(reader.apply(reset(['stale']))).toMatchObject({ kind: 'rejected', reason: 'generation' })
    reader.dispose()
    expect(reader.apply(reset(['late'], point(0), null, replacement))).toMatchObject({
      kind: 'rejected',
      reason: 'disposed',
    })
    expect(reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })

  it('requires fresh ordered registration after release while other documents stay active', () => {
    const reader = new DocumentWorkerReader()
    reader.apply({ kind: 'register', identity })
    reader.apply(reset(['closed']))
    const other = { ...identity, documentId: 'other', registrationId: 2 }
    reader.apply({ kind: 'register', identity: other })
    reader.apply(reset(['survivor'], point(0), null, other))
    expect(reader.apply({ kind: 'release', identity })).toMatchObject({ kind: 'released' })
    expect(reader.apply(reset(['late']))).toMatchObject({ kind: 'rejected', reason: 'detached' })
    expect(reader.apply({ kind: 'register', identity })).toMatchObject({
      kind: 'rejected',
      reason: 'generation',
    })
    const survivor = reader.acquire({ identity: other, point: point(0) })!
    expect(survivor.text.readRange(0, survivor.text.length)).toBe('survivor')
    expect(reader.inspect()).toEqual({ documents: 1, reads: 1, pins: 0, sourceUnits: 8 })
    reader.dispose()
    expect(reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })
})
