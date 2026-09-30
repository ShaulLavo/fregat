import {
  applyBatchToPieceTable,
  createDocumentLogicalRevisionScope,
  createDocumentTextSnapshot,
  createEditorTextBuffer,
  createPieceTableSnapshot,
  materializePieceTableFullText,
} from '@singapore-editor/core/document'
import type {
  DocumentTextSnapshot,
  EditorTextBuffer,
  PieceTableSnapshot,
} from '@singapore-editor/core/document'
import { describe, expect, it } from 'vitest'

import type { ParsedWorkspaceTextEdit, WorkspaceEditOperation } from '../src/workspaceEdit'
import {
  prepareWorkspaceTextReplay,
  type WorkspaceTextDocumentProvenance,
  type WorkspaceTextReplaySegmentInput,
} from '../src/workspaceTextEdits'

type TextOperation = Extract<WorkspaceEditOperation, { kind: 'text-document' }>

type ReplayFixture = {
  readonly buffer: EditorTextBuffer
  readonly initialSnapshot: DocumentTextSnapshot
}

const position = (character: number, line = 0) => ({ character, line })

const edit = (
  start: number,
  end: number,
  newText: string,
  annotationId?: string,
): ParsedWorkspaceTextEdit => ({
  ...(annotationId === undefined ? {} : { annotationId }),
  newText,
  range: { end: position(end), start: position(start) },
})

const operation = (
  uri: string,
  version: number | null,
  edits: readonly ParsedWorkspaceTextEdit[],
): TextOperation => ({ edits, kind: 'text-document', uri, version })

const replaySegment = (
  uri: string,
  operations: readonly TextOperation[],
  segmentIndex = 0,
  operationIndexBase = 0,
): WorkspaceTextReplaySegmentInput => ({
  operations: operations.map((entry, index) => ({
    operation: entry,
    operationIndex: operationIndexBase + index,
  })),
  segmentIndex,
  uri,
})

function fixture(text: string): ReplayFixture {
  const buffer = createEditorTextBuffer(text)
  return { buffer, initialSnapshot: buffer.getTextSnapshot() }
}

function provenance(
  fixture: ReplayFixture,
  uri: string,
  version: number,
): WorkspaceTextDocumentProvenance {
  return { textSnapshot: fixture.initialSnapshot, uri, version }
}

function prepare(
  fixture: ReplayFixture,
  segments: readonly WorkspaceTextReplaySegmentInput[],
  provenanceEntries: readonly WorkspaceTextDocumentProvenance[] = [],
  expectedRevision = fixture.buffer.getRevision(),
) {
  return prepareWorkspaceTextReplay({
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    provenance: provenanceEntries,
    segments,
    target: {
      buffer: fixture.buffer,
      expectedRevision,
      initialSnapshot: fixture.initialSnapshot,
    },
  })
}

function textOf(snapshot: PieceTableSnapshot): string {
  return materializePieceTableFullText(snapshot)
}

describe('prepareWorkspaceTextReplay', () => {
  it('converts UTF-16 positions from a piece-table snapshot without materializing full text', () => {
    const target = fixture('alpha\n😀z\n')
    const source = target.initialSnapshot
    let materialized = false
    const guardedSnapshot = Object.assign(createDocumentTextSnapshot(source.snapshot), {
      materializeFullText: () => {
        materialized = true
        throw new Error('full text must not be materialized')
      },
    })
    const result = prepareWorkspaceTextReplay({
      logicalRevisionScope: createDocumentLogicalRevisionScope(),
      provenance: [],
      segments: [
        replaySegment('file:///a.ts', [
          {
            edits: [
              {
                newText: 'X',
                range: { end: position(2, 1), start: position(2, 1) },
              },
            ],
            kind: 'text-document',
            uri: 'file:///a.ts',
            version: null,
          },
        ]),
      ],
      target: {
        buffer: target.buffer,
        expectedRevision: target.buffer.getRevision(),
        initialSnapshot: guardedSnapshot,
      },
    })

    expect(result).toMatchObject({ ok: true })
    expect(materialized).toBe(false)
    if (!result.ok) return
    expect(textOf(result.segments[0]!.snapshotAfter)).toBe('alpha\n😀Xz\n')
  })

  it('binds validated segments to the exact buffer revision and snapshot as one prepared sequence', () => {
    const target = fixture('abc')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [operation('file:///a.ts', null, [edit(0, 1, 'x')])]),
      replaySegment('file:///a.ts', [operation('file:///a.ts', null, [edit(1, 2, 'y')])], 1, 1),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok || !result.sequence) return
    expect(result.sequence.expectedRevision).toBe(target.buffer.getRevision())
    expect(result.sequence.snapshotBefore).toBe(target.initialSnapshot.snapshot)
    expect(result.segments.map((segment) => segment.sequenceSegmentIndex)).toEqual([0, 1])
    expect(result.segments[0]!.snapshotAfter).toBe(result.sequence.segments[0]!.snapshotAfter)
    expect(result.segments[1]!.snapshotAfter).toBe(result.sequence.snapshotAfter)
  })

  it('rejects a stale target buffer guard without returning validated-but-unbound edits', () => {
    const target = fixture('abc')
    const result = prepare(
      target,
      [replaySegment('file:///a.ts', [operation('file:///a.ts', null, [edit(0, 1, 'x')])])],
      [],
      target.buffer.getRevision() + 1,
    )

    expect(result).toMatchObject({ error: { code: 'snapshot-drift' }, ok: false })
  })

  it('rejects negative fractional missing-line and past-line positions', () => {
    const invalidPositions = [
      { end: position(0), start: position(-1) },
      { end: position(0), start: position(0.5) },
      { end: position(0), start: position(0, 2) },
      { end: position(0), start: position(4, 0) },
    ]

    for (const range of invalidPositions) {
      const target = fixture('abc\n')
      const result = prepare(target, [
        replaySegment('file:///a.ts', [operation('file:///a.ts', null, [{ newText: 'x', range }])]),
      ])
      expect(result).toMatchObject({ error: { code: 'invalid-position' }, ok: false })
    }
  })

  it('rejects reversed ranges overlapping ranges and coincident inserts', () => {
    const cases: readonly [readonly ParsedWorkspaceTextEdit[], string][] = [
      [[edit(2, 1, 'x')], 'reversed-range'],
      [[edit(0, 2, 'x'), edit(1, 3, 'y')], 'overlapping-edits'],
      [[edit(1, 1, 'x'), edit(1, 1, 'y')], 'ambiguous-inserts'],
    ]

    for (const [edits, code] of cases) {
      const target = fixture('abc')
      const result = prepare(target, [
        replaySegment('file:///a.ts', [operation('file:///a.ts', null, edits)]),
      ])
      expect(result).toMatchObject({ error: { code }, ok: false })
    }
  })

  it('accepts unsorted adjacent edits against one snapshot', () => {
    const target = fixture('abcdef')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [
        operation('file:///a.ts', null, [edit(3, 5, 'X'), edit(0, 3, 'Y')]),
      ]),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(textOf(result.segments[0]!.snapshotAfter)).toBe('YXf')
  })

  it('checks a non-null LSP version before range preparation', () => {
    const target = fixture('abc')
    const result = prepare(
      target,
      [
        replaySegment('file:///a.ts', [
          operation('file:///a.ts', 8, [
            { newText: 'x', range: { end: position(0), start: position(99) } },
          ]),
        ]),
      ],
      [provenance(target, 'file:///a.ts', 7)],
    )

    expect(result).toMatchObject({ error: { code: 'version-mismatch' }, ok: false })
  })

  it('rejects an unmapped version instead of treating it as unversioned', () => {
    const target = fixture('abc')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [operation('file:///a.ts', 7, [edit(0, 1, 'x')])]),
    ])

    expect(result).toMatchObject({ error: { code: 'version-mismatch' }, ok: false })
  })

  it('accepts repeated effective same-target versions N then N-plus-one and advances once per operation', () => {
    const target = fixture('a')
    const result = prepare(
      target,
      [
        replaySegment('file:///a.ts', [
          operation('file:///a.ts', 7, [edit(0, 1, 'b')]),
          operation('file:///a.ts', 8, [edit(0, 1, 'c')]),
        ]),
      ],
      [provenance(target, 'file:///a.ts', 7)],
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok || !result.sequence) return
    expect(result.segments[0]).toMatchObject({
      logicalRevisionCount: 2,
      simulatedVersionAfter: 9,
      simulatedVersionBefore: 7,
    })
    expect(result.sequence.segments[0]!.logicalRevisionCount).toBe(2)
    expect(textOf(result.sequence.snapshotAfter)).toBe('c')
  })

  it('rejects repeated same-target versions N then N or N-plus-two when the first step is effective', () => {
    for (const secondVersion of [7, 9]) {
      const target = fixture('a')
      const result = prepare(
        target,
        [
          replaySegment('file:///a.ts', [
            operation('file:///a.ts', 7, [edit(0, 1, 'b')]),
            operation('file:///a.ts', secondVersion, [edit(0, 1, 'c')]),
          ]),
        ],
        [provenance(target, 'file:///a.ts', 7)],
      )
      expect(result).toMatchObject({
        error: { code: 'version-mismatch', operationIndex: 1 },
        ok: false,
      })
    }
  })

  it('retains empty and same-text steps as no-ops without version advancement and returns a null all-no-op transaction', () => {
    const target = fixture('a')
    const result = prepare(
      target,
      [
        replaySegment('file:///a.ts', [
          operation('file:///a.ts', 7, []),
          operation('file:///a.ts', 7, [edit(0, 1, 'a')]),
        ]),
      ],
      [provenance(target, 'file:///a.ts', 7)],
    )

    expect(result).toMatchObject({ ok: true, sequence: null })
    if (!result.ok) return
    expect(result.segments[0]).toMatchObject({
      logicalRevisionCount: 0,
      simulatedVersionAfter: 7,
      simulatedVersionBefore: 7,
    })
    expect(result.segments[0]!.steps).toHaveLength(2)
    expect(result.segments[0]!.snapshotAfter).toBe(target.initialSnapshot.snapshot)
  })

  it('retains effective steps that restore initial text and returns a non-null logical transaction', () => {
    const target = fixture('a')
    const result = prepare(
      target,
      [
        replaySegment('file:///a.ts', [
          operation('file:///a.ts', 7, [edit(0, 1, 'b')]),
          operation('file:///a.ts', 8, [edit(0, 1, 'a')]),
        ]),
      ],
      [provenance(target, 'file:///a.ts', 7)],
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok || !result.sequence) return
    expect(result.segments[0]!.logicalRevisionCount).toBe(2)
    expect(result.segments[0]!.snapshotAfter).toBe(result.segments[0]!.snapshotBefore)
    expect(result.sequence.segments[0]!.hasTextChange).toBe(false)
  })

  it('rejects a non-null post-rename URI without exact lane provenance', () => {
    const target = fixture('a')
    const result = prepare(
      target,
      [
        replaySegment('file:///old.ts', [operation('file:///old.ts', 7, [edit(0, 1, 'b')])]),
        replaySegment('file:///new.ts', [operation('file:///new.ts', 8, [edit(0, 1, 'c')])], 1, 1),
      ],
      [provenance(target, 'file:///old.ts', 7)],
    )

    expect(result).toMatchObject({
      error: { code: 'version-mismatch', operationIndex: 1 },
      ok: false,
    })
  })

  it('preserves annotation ids in prepared edits', () => {
    const target = fixture('a')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [operation('file:///a.ts', null, [edit(0, 1, 'b', 'rename')])]),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.segments[0]!.steps[0]!.edits).toEqual([
      { annotationId: 'rename', from: 0, text: 'b', to: 1 },
    ])
  })

  it('preserves parser CRLF then reports normalized effective text and surrogate snapping', () => {
    const target = fixture('😀a')
    const parsedEdit = edit(1, 2, '\r\n')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [operation('file:///a.ts', null, [parsedEdit])]),
    ])

    expect(parsedEdit.newText).toBe('\r\n')
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.segments[0]!.steps[0]!.edits).toEqual([{ from: 0, text: '\n', to: 2 }])
    expect(textOf(result.segments[0]!.snapshotAfter)).toBe('\na')
  })

  it('reports the exact merged batch core applies after surrogate snapping', () => {
    const target = fixture('😀')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [
        operation('file:///a.ts', null, [edit(0, 1, 'A', 'rename'), edit(1, 1, 'I', 'rename')]),
      ]),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const reported = result.segments[0]!.steps[0]!.edits
    expect(reported).toEqual([{ annotationId: 'rename', from: 0, text: 'AI', to: 2 }])
    const replayed = applyBatchToPieceTable(target.initialSnapshot.snapshot, reported)
    expect(textOf(replayed)).toBe(textOf(result.segments[0]!.steps[0]!.snapshotAfter))
    expect(textOf(replayed)).toBe('AI')
  })

  it('rejects surrogate snapping that would merge different annotation ids', () => {
    const target = fixture('😀')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [
        operation('file:///a.ts', null, [edit(0, 1, 'A', 'first'), edit(1, 1, 'I', 'second')]),
      ]),
    ])

    expect(result).toMatchObject({
      error: { code: 'overlapping-edits', editIndex: 1, operationIndex: 0 },
      ok: false,
    })
    expect(target.buffer.getSnapshot()).toBe(target.initialSnapshot.snapshot)
  })

  it('applies repeated document operations sequentially while preserving operation order', () => {
    const target = fixture('abc')
    const result = prepare(target, [
      replaySegment('file:///a.ts', [
        operation('file:///a.ts', null, [edit(0, 1, 'x')]),
        operation('file:///a.ts', null, [edit(1, 2, 'y')]),
      ]),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.segments[0]!.steps.map((step) => step.operationIndex)).toEqual([0, 1])
    expect(textOf(result.segments[0]!.steps[0]!.snapshotAfter)).toBe('xbc')
    expect(textOf(result.segments[0]!.snapshotAfter)).toBe('xyc')
  })

  it('prepares edit-old rename-boundary edit-new as two commit-ready segments with one version continuation', () => {
    const target = fixture('abc')
    const result = prepare(
      target,
      [
        replaySegment('file:///old.ts', [operation('file:///old.ts', 4, [edit(0, 1, 'x')])]),
        replaySegment(
          'file:///new.ts',
          [operation('file:///new.ts', null, [edit(1, 2, 'y')])],
          1,
          1,
        ),
      ],
      [provenance(target, 'file:///old.ts', 4)],
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok || !result.sequence) return
    expect(
      result.segments.map((segment) => ({
        after: segment.simulatedVersionAfter,
        before: segment.simulatedVersionBefore,
        sequence: segment.sequenceSegmentIndex,
      })),
    ).toEqual([
      { after: 5, before: 4, sequence: 0 },
      { after: 6, before: 5, sequence: 1 },
    ])
    expect(result.sequence.segments).toHaveLength(2)
    expect(textOf(result.sequence.snapshotAfter)).toBe('xyc')
  })

  it('rejects a target whose supplied snapshot is not the live buffer identity', () => {
    const target = fixture('abc')
    const unrelated = createDocumentTextSnapshot(createPieceTableSnapshot('abc'))
    const result = prepareWorkspaceTextReplay({
      logicalRevisionScope: createDocumentLogicalRevisionScope(),
      provenance: [],
      segments: [
        replaySegment('file:///a.ts', [operation('file:///a.ts', null, [edit(0, 1, 'x')])]),
      ],
      target: {
        buffer: target.buffer,
        expectedRevision: target.buffer.getRevision(),
        initialSnapshot: unrelated,
      },
    })

    expect(result).toMatchObject({ error: { code: 'snapshot-drift' }, ok: false })
  })
})
