import { describe, expect, it } from 'vitest'

import {
  arrayLspLineStarts,
  LspWorkspace,
  type LspDocument,
  type LspTextSnapshot,
} from '../src/index.ts'

type SyncCall = {
  readonly kind: 'change' | 'close' | 'open'
  readonly text: string
  readonly uri: string
  readonly version: number
}

function trackedWorkspace() {
  const calls: SyncCall[] = []
  const workspace = new LspWorkspace()
  workspace.attachClient({
    didOpenDocument: (document) => calls.push(syncCall('open', document)),
    didChangeDocument: (document) => calls.push(syncCall('change', document)),
    didCloseDocument: (document) => calls.push(syncCall('close', document)),
    didSaveDocument: () => {},
  })
  return { calls, workspace }
}

const URI = 'file:///w/a.ts'

describe('LspWorkspace snapshot attachments', () => {
  it('cold open preserves the caller text snapshot identity before any edit', () => {
    const { workspace } = trackedWorkspace()
    const textSnapshot = snapshot('const a = 1')
    const opened = workspace.openDocumentSnapshot(
      openOptions(textSnapshot, { sourceSegment: {}, sourceRevision: 7 }),
    )

    expect(opened.document.textSnapshot).toBe(textSnapshot)
    expect(workspace.getDocument(URI)?.textSnapshot).toBe(textSnapshot)
  })

  it('announces one didOpen and waits for the final opaque attachment before didClose', () => {
    const { calls, workspace } = trackedWorkspace()
    const textSnapshot = snapshot('const a = 1')
    const sourceSegment = {}
    const first = workspace.openDocumentSnapshot(openOptions(textSnapshot, { sourceSegment }))
    const second = workspace.openDocumentSnapshot(
      openOptions(textSnapshot, { lineStarts: arrayLspLineStarts([0, 6]), sourceSegment }),
    )

    workspace.closeDocument(first.attachment)
    expect(workspace.getDocument(URI)).not.toBeNull()
    expect(calls.map((call) => call.kind)).toEqual(['open'])

    workspace.closeDocument(second.attachment)
    expect(workspace.getDocument(URI)).toBeNull()
    expect(calls.map((call) => call.kind)).toEqual(['open', 'close'])
  })

  it('refuses a second attachment that does not share the exact snapshot source point', () => {
    const { workspace } = trackedWorkspace()
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(snapshot('const a = 1'), { sourceSegment }))

    expect(() =>
      workspace.openDocumentSnapshot(openOptions(snapshot('const a = 1'), { sourceSegment })),
    ).toThrow(/exact shared source point/)
  })

  it('advances one didChange version by the supplied positive logical revision count', () => {
    const { calls, workspace } = trackedWorkspace()
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(snapshot('one'), { sourceSegment }))

    const document = workspace.updateDocumentSnapshot(URI, {
      edits: [{ from: 0, to: 3, text: 'two' }],
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount: 4,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: snapshot('two'),
    })

    expect(document.version).toBe(4)
    expect(calls.filter((call) => call.kind === 'change')).toEqual([
      { kind: 'change', text: 'two', uri: URI, version: 4 },
    ])
  })

  it('rejects a negative fractional or zero count for a changed snapshot', () => {
    const { workspace } = trackedWorkspace()
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(snapshot('one'), { sourceSegment }))

    for (const logicalRevisionCount of [-1, 0.5, 0]) {
      expectInvalidLogicalRevisionCount(workspace, sourceSegment, logicalRevisionCount)
    }
    expect(workspace.getDocument(URI)?.textSnapshot.readRange(0, 3)).toBe('one')
  })

  it('rejects unsafe source metadata and version overflow before mutating the document', () => {
    const { calls, workspace } = trackedWorkspace()
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(snapshot('one'), { sourceSegment }))
    const changed = snapshot('two')

    expect(() =>
      workspace.updateDocumentSnapshot(URI, {
        edits: null,
        lineStarts: arrayLspLineStarts([0]),
        logicalRevisionCount: Number.MAX_SAFE_INTEGER + 1,
        sourceRevision: 1,
        sourceSegment,
        textSnapshot: changed,
      }),
    ).toThrow(/safe non-negative integer/)
    expect(() =>
      workspace.updateDocumentSnapshot(URI, {
        edits: null,
        lineStarts: arrayLspLineStarts([0]),
        logicalRevisionCount: 1,
        sourceRevision: Number.MAX_SAFE_INTEGER + 1,
        sourceSegment,
        textSnapshot: changed,
      }),
    ).toThrow(/safe non-negative integer/)

    const atMaximumVersion = workspace.updateDocumentSnapshot(URI, {
      edits: null,
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount: Number.MAX_SAFE_INTEGER,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: changed,
    })
    expect(atMaximumVersion.version).toBe(Number.MAX_SAFE_INTEGER)

    expect(() =>
      workspace.updateDocumentSnapshot(URI, {
        edits: null,
        lineStarts: arrayLspLineStarts([0]),
        logicalRevisionCount: 1,
        sourceRevision: 2,
        sourceSegment,
        textSnapshot: snapshot('three'),
      }),
    ).toThrow(/version exceeds the safe integer range/)
    expect(workspace.getDocument(URI)?.textSnapshot).toBe(changed)
    expect(calls.filter((call) => call.kind === 'change')).toHaveLength(1)
  })

  it('adopts a duplicate source tuple with zero count despite a distinct line-start view without another didChange', () => {
    const { calls, workspace } = trackedWorkspace()
    const sourceSegment = {}
    const initial = snapshot('one')
    workspace.openDocumentSnapshot(openOptions(initial, { sourceSegment }))
    const changed = snapshot('two')
    workspace.updateDocumentSnapshot(URI, {
      edits: null,
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount: 2,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: changed,
    })

    const adopted = workspace.updateDocumentSnapshot(URI, {
      edits: [],
      lineStarts: arrayLspLineStarts([0, 1]),
      logicalRevisionCount: 0,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: changed,
    })

    expect(adopted.version).toBe(2)
    expect(calls.filter((call) => call.kind === 'change')).toHaveLength(1)
  })

  it('adopts a new unchanged source point without didChange and rejects a mismatched snapshot', () => {
    const { calls, workspace } = trackedWorkspace()
    const textSnapshot = snapshot('one')
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(textSnapshot, { sourceSegment }))

    const adopted = workspace.adoptUnchangedDocumentSource(URI, {
      lineStarts: arrayLspLineStarts([0, 2]),
      sourceRevision: 1,
      sourceSegment,
      textSnapshot,
    })

    expect(adopted.version).toBe(0)
    expect(calls.filter((call) => call.kind === 'change')).toEqual([])
    expect(() =>
      workspace.adoptUnchangedDocumentSource(URI, {
        lineStarts: arrayLspLineStarts([0]),
        sourceRevision: 2,
        sourceSegment,
        textSnapshot: snapshot('one'),
      }),
    ).toThrow(/exact workspace text snapshot/)
  })

  it('full-sync fallback keeps the source segment and logical count', () => {
    const { calls, workspace } = trackedWorkspace()
    const sourceSegment = {}
    workspace.openDocumentSnapshot(openOptions(snapshot('one'), { sourceSegment }))
    const changed = snapshot('two')
    workspace.updateDocumentSnapshot(URI, {
      edits: null,
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount: 3,
      sourceRevision: 9,
      sourceSegment,
      textSnapshot: changed,
    })

    const duplicate = workspace.updateDocumentSnapshot(URI, {
      edits: null,
      lineStarts: arrayLspLineStarts([0, 1]),
      logicalRevisionCount: 0,
      sourceRevision: 9,
      sourceSegment,
      textSnapshot: changed,
    })

    expect(duplicate.version).toBe(3)
    expect(calls.filter((call) => call.kind === 'change')).toHaveLength(1)
  })

  it('two mounted attachments adopt one duplicate source revision', () => {
    const { calls, workspace } = trackedWorkspace()
    const sourceSegment = {}
    const initial = snapshot('one')
    workspace.openDocumentSnapshot(openOptions(initial, { sourceSegment }))
    workspace.openDocumentSnapshot(openOptions(initial, { sourceSegment }))
    const changed = snapshot('two')
    const update = {
      edits: null,
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount: 1,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: changed,
    } as const

    workspace.updateDocumentSnapshot(URI, update)
    workspace.updateDocumentSnapshot(URI, update)
    expect(() =>
      workspace.updateDocumentSnapshot(URI, { ...update, logicalRevisionCount: 2 }),
    ).toThrow(/logical revision count/)

    expect(calls.filter((call) => call.kind === 'change')).toHaveLength(1)
  })

  it('a URI transition rotates the segment and closes old before opening new', () => {
    const { calls, workspace } = trackedWorkspace()
    const initial = snapshot('one')
    const sourceSegment = {}
    const transitions: Array<{ readonly sourceTextVersion: number; readonly uri: string }> = []
    const first = workspace.openDocumentSnapshot(
      openOptions(initial, {
        onDocumentTransition: ({ document, sourceTextVersion }) =>
          transitions.push({ sourceTextVersion, uri: document.uri }),
        sourceSegment,
      }),
    )
    workspace.openDocumentSnapshot(
      openOptions(initial, {
        onDocumentTransition: ({ document, sourceTextVersion }) =>
          transitions.push({ sourceTextVersion, uri: document.uri }),
        sourceSegment,
      }),
    )

    const nextSegment = {}
    workspace.transitionDocumentUri(first.attachment, {
      languageId: 'typescript',
      lineStarts: arrayLspLineStarts([0]),
      sourceRevision: 0,
      sourceSegment: nextSegment,
      sourceTextVersion: 17,
      textSnapshot: initial,
      uri: 'file:///w/b.ts',
    })

    expect(calls.map((call) => `${call.kind}:${call.uri}`)).toEqual([
      `open:${URI}`,
      `close:${URI}`,
      'open:file:///w/b.ts',
    ])
    expect(transitions).toEqual([
      { sourceTextVersion: 17, uri: 'file:///w/b.ts' },
      { sourceTextVersion: 17, uri: 'file:///w/b.ts' },
    ])
  })

  it('rejects a mismatched URI transition before close or open', () => {
    const { calls, workspace } = trackedWorkspace()
    const initial = snapshot('one')
    const opened = workspace.openDocumentSnapshot(openOptions(initial, { sourceSegment: {} }))

    expect(() =>
      workspace.transitionDocumentUri(opened.attachment, {
        languageId: 'typescript',
        lineStarts: arrayLspLineStarts([0]),
        sourceRevision: 0,
        sourceSegment: {},
        sourceTextVersion: 0,
        textSnapshot: snapshot('two'),
        uri: 'file:///w/b.ts',
      }),
    ).toThrow(/exact synchronized snapshot/)

    expect(calls.map((call) => `${call.kind}:${call.uri}`)).toEqual([`open:${URI}`])
    expect(workspace.getDocument(URI)?.textSnapshot).toBe(initial)
    expect(workspace.getDocument('file:///w/b.ts')).toBeNull()
  })

  it('a final close and reattach rotates the workspace sync segment', () => {
    const { calls, workspace } = trackedWorkspace()
    const first = workspace.openDocumentSnapshot(
      openOptions(snapshot('one'), { sourceSegment: {} }),
    )
    workspace.closeDocument(first.attachment)
    workspace.openDocumentSnapshot(openOptions(snapshot('one'), { sourceSegment: {} }))

    expect(calls.map((call) => call.kind)).toEqual(['open', 'close', 'open'])
  })
})

function openOptions(
  textSnapshot: LspTextSnapshot,
  options: {
    readonly lineStarts?: ReturnType<typeof arrayLspLineStarts>
    readonly onDocumentTransition?: Parameters<
      LspWorkspace['openDocumentSnapshot']
    >[0]['onDocumentTransition']
    readonly sourceRevision?: number
    readonly sourceSegment: object
  },
): Parameters<LspWorkspace['openDocumentSnapshot']>[0] {
  return {
    languageId: 'typescript',
    lineStarts: options.lineStarts ?? arrayLspLineStarts([0]),
    onDocumentTransition: options.onDocumentTransition,
    sourceRevision: options.sourceRevision ?? 0,
    sourceSegment: options.sourceSegment,
    textSnapshot,
    uri: URI,
  }
}

function snapshot(text: string): LspTextSnapshot {
  return {
    length: text.length,
    readRange: (start, end) => text.slice(start, end),
    forEachTextChunk: (visit) => {
      if (text.length === 0) return
      visit(text, 0, text.length)
    },
  }
}

function syncCall(kind: SyncCall['kind'], document: LspDocument): SyncCall {
  return {
    kind,
    text: document.textSnapshot.readRange(0, document.textSnapshot.length),
    uri: document.uri,
    version: document.version,
  }
}

function expectInvalidLogicalRevisionCount(
  workspace: LspWorkspace,
  sourceSegment: object,
  logicalRevisionCount: number,
): void {
  expect(() =>
    workspace.updateDocumentSnapshot(URI, {
      edits: null,
      lineStarts: arrayLspLineStarts([0]),
      logicalRevisionCount,
      sourceRevision: 1,
      sourceSegment,
      textSnapshot: snapshot('two'),
    }),
  ).toThrow()
}
