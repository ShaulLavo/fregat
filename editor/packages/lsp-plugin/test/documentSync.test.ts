import {
  acquireDocumentMutationLease,
  commitPreparedDocumentTransaction,
  createDocumentLogicalRevisionScope,
  createEditorBufferSession,
  createEditorTextBuffer,
  prepareDocumentTransaction,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
  type DocumentLogicalRevisionScope,
  type DocumentSessionChange,
  type DocumentSyncPoint,
  type EditorBufferSession,
  type EditorTextBuffer,
  type TextEdit,
} from '@singapore-editor/core/document'
import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'
import {
  LspWorkspace,
  type LspDocumentChange,
  type LspTextSnapshot,
  type LspWorkspaceSyncTarget,
} from '@singapore-editor/lsp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  activeDocumentForSnapshot,
  DocumentSync,
  type DocumentSyncDiagnosticsPresenter,
} from '../src/documentSync'
import { LanguageServerDocumentSyncController } from '../src/documentSyncController'
import type { LanguageServerDocumentSyncOptions } from '../src/types'

type TestLineStartsView = NonNullable<EditorViewSnapshot['lineStartsView']>

describe('DocumentSync', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports a full-sync fallback after the retained edit chain is exhausted', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('abc')
    const sync = createSync(workspace, scope)
    sync.sync(harness.snapshot(), null)
    for (let index = 0; index < 129; index++)
      harness.ordinary([{ from: 3 + index, to: 3 + index, text: 'x' }])
    const record = vi.fn()
    vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', record)
    sync.sync(harness.snapshot(), null)
    expect(recorder.changes).toEqual([
      { editCount: 0, text: 'abc' + 'x'.repeat(129), version: 129 },
    ])
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'lsp.documentSync.editChain',
        detail: expect.objectContaining({ chained: 'null', logicalRevisionCount: 129 }),
      }),
    )
    sync.close()
  })

  it('syncs an opaque native identity at the resolved URI and protocol language', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const harness = new BufferHarness('const view = <div />;')
    const snapshot = harness.snapshot({ documentId: '["file","src/view.tsx"]' })
    const options: LanguageServerDocumentSyncOptions = {
      uriForDocument: () => 'file:///src/view.tsx',
      languageIdForDocument: (languageId, uri) =>
        uri.endsWith('.tsx') ? 'typescriptreact' : languageId,
    }
    const sync = createSync(workspace, createDocumentLogicalRevisionScope(), options)

    sync.sync(snapshot, null)
    expect(sync.activeDocument).toMatchObject({
      uri: 'file:///src/view.tsx',
      languageId: 'typescriptreact',
    })
    expect(activeDocumentForSnapshot(snapshot, options)).toMatchObject({
      uri: 'file:///src/view.tsx',
      languageId: 'typescriptreact',
    })
    expect(recorder.events).toEqual(['open:file:///src/view.tsx:0:const view = <div />;'])
    expect(snapshot.documentId).toBe('["file","src/view.tsx"]')
  })

  it('suppresses URI resolution without falling back to the native identity', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const harness = new BufferHarness('one')
    const snapshot = harness.snapshot({ documentId: 'opaque-document' })
    let uri: string | null = null
    const options: LanguageServerDocumentSyncOptions = { uriForDocument: () => uri }
    const sync = createSync(workspace, createDocumentLogicalRevisionScope(), options)

    sync.sync(snapshot, null)
    expect(recorder.events).toEqual([])
    expect(activeDocumentForSnapshot(snapshot, options)).toBeNull()
    uri = 'file:///src/index.ts'
    sync.sync(snapshot, null)
    uri = null
    sync.sync(snapshot, null)

    expect(sync.activeDocument).toBeNull()
    expect(recorder.events).toEqual([
      'open:file:///src/index.ts:0:one',
      'close:file:///src/index.ts:0:one',
    ])
  })

  it('opens updates and closes exact snapshots through an opaque workspace attachment', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('let value = 1;')
    const sync = createSync(workspace, scope)

    sync.sync(harness.snapshot(), null)
    expect(sync.activeDocument?.textSnapshot).toBe(harness.buffer.getTextSnapshot())
    const change = harness.ordinary([{ from: 12, to: 13, text: '2' }])
    sync.sync(harness.snapshot(), change)
    sync.close()

    expect(recorder.events).toEqual([
      'open:file:///src/index.ts:0:let value = 1;',
      'change:file:///src/index.ts:1:12-13=2',
      'close:file:///src/index.ts:1:let value = 2;',
    ])
  })

  it('publishes one atomic workspace edit change at the simulated final LSP version', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const sync = createSync(workspace, scope)
    sync.sync(harness.snapshot(), null)

    const change = harness.workspaceEdit(scope, 4, [{ from: 0, to: 3, text: 'two' }])
    sync.sync(harness.snapshot(), change)

    expect(sync.activeDocument?.lspVersion).toBe(4)
    expect(recorder.changes).toEqual([{ editCount: 1, text: 'two', version: 4 }])
  })

  it('composes a workspace logical count with later ordinary edits during deferred sync', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('abc')
    const sync = createSync(workspace, scope)
    sync.sync(harness.snapshot(), null)

    harness.workspaceEdit(scope, 3, [{ from: 3, to: 3, text: 'X' }])
    const ordinary = harness.ordinary([{ from: 4, to: 4, text: 'Y' }])
    sync.sync(harness.snapshot(), ordinary)

    expect(sync.activeDocument?.lspVersion).toBe(4)
    expect(recorder.changes).toEqual([{ editCount: 1, text: 'abcXY', version: 4 }])
  })

  it('two mounted observers with distinct line-start views synchronize one shared buffer change once', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const first = createSync(workspace, scope)
    const second = createSync(workspace, scope)
    first.sync(harness.snapshot({ lineStartsView: lineStartsView('one') }), null)
    second.sync(harness.snapshot({ lineStartsView: lineStartsView('one') }), null)

    const change = harness.workspaceEdit(scope, 2, [{ from: 0, to: 3, text: 'two' }])
    first.sync(harness.snapshot({ lineStartsView: lineStartsView('two') }), change)
    second.sync(harness.snapshot({ lineStartsView: lineStartsView('two') }), change)

    expect(recorder.changes).toEqual([{ editCount: 1, text: 'two', version: 2 }])
    expect(first.activeDocument?.lspVersion).toBe(2)
    expect(second.activeDocument?.lspVersion).toBe(2)
  })

  it('falls back to full sync without losing the logical revision delta', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('abcdef')
    const sync = createSync(workspace, scope)
    sync.sync(harness.snapshot(), null)

    harness.workspaceEdit(scope, 2, [{ from: 2, to: 4, text: 'XY' }])
    const ordinary = harness.ordinary([{ from: 1, to: 3, text: 'Q' }])
    const deferred = harness
      .snapshot()
      .changesSinceDocumentSyncPoint(syncPointAtOpen(harness, 0), scope)
    expect(deferred?.edits).toBeNull()
    expect(deferred?.logicalRevisionCount).toBe(3)
    sync.sync(harness.snapshot(), ordinary)

    expect(recorder.changes).toEqual([{ editCount: 0, text: 'aQYef', version: 3 }])
  })

  it('full-syncs a same-version replacement buffer after its sync segment rotates', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const sync = createSync(workspace, scope)
    sync.sync(new BufferHarness('one').snapshot(), null)

    sync.sync(new BufferHarness('two').snapshot(), null)

    expect(recorder.changes).toEqual([{ editCount: 0, text: 'two', version: 1 }])
  })

  it('emits one full same-text didChange for a net-identical effective replay', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const sync = createSync(workspace, scope)
    sync.sync(harness.snapshot(), null)

    const change = harness.workspaceEdit(scope, 5, [{ from: 0, to: 3, text: 'one' }])
    expect(change.kind).toBe('synchronize')
    expect(sync.shouldSync('content', harness.snapshot())).toBe(true)
    sync.sync(harness.snapshot(), change)

    expect(recorder.changes).toEqual([{ editCount: 0, text: 'one', version: 5 }])
  })

  it('a non-originating lane advances once for changed final text and not at all for logical-only text', () => {
    const originWorkspace = new LspWorkspace()
    const otherWorkspace = new LspWorkspace()
    const originRecorder = new SyncTargetRecorder()
    const otherRecorder = new SyncTargetRecorder()
    originWorkspace.attachClient(originRecorder)
    otherWorkspace.attachClient(otherRecorder)
    const originScope = createDocumentLogicalRevisionScope()
    const otherScope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const origin = createSync(originWorkspace, originScope)
    const other = createSync(otherWorkspace, otherScope)
    origin.sync(harness.snapshot(), null)
    other.sync(harness.snapshot(), null)

    const changed = harness.workspaceEdit(originScope, 3, [{ from: 0, to: 3, text: 'two' }])
    origin.sync(harness.snapshot(), changed)
    other.sync(harness.snapshot(), changed)
    const logicalOnly = harness.workspaceEdit(originScope, 2, [{ from: 0, to: 3, text: 'two' }])
    origin.sync(harness.snapshot(), logicalOnly)
    other.sync(harness.snapshot(), logicalOnly)

    expect(originRecorder.changes.map((change) => change.version)).toEqual([3, 5])
    expect(otherRecorder.changes.map((change) => change.version)).toEqual([1])
    expect(other.activeDocument?.lspVersion).toBe(1)
  })

  it('a non-origin logical-only change adopts its point so the next ordinary edit advances once', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const originScope = createDocumentLogicalRevisionScope()
    const otherScope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const sync = createSync(workspace, otherScope)
    sync.sync(harness.snapshot(), null)

    const logicalOnly = harness.workspaceEdit(originScope, 7, [{ from: 0, to: 3, text: 'one' }])
    sync.sync(harness.snapshot(), logicalOnly)
    expect(recorder.changes).toEqual([])

    const ordinary = harness.ordinary([{ from: 3, to: 3, text: '!' }])
    sync.sync(harness.snapshot(), ordinary)
    expect(recorder.changes).toEqual([{ editCount: 1, text: 'one!', version: 1 }])
  })

  it('a URI transition rotates the segment and closes old before opening new', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const first = createSync(workspace, scope)
    const second = createSync(workspace, scope)
    first.sync(harness.snapshot(), null)
    second.sync(harness.snapshot(), null)

    harness.rotateSyncSegment()
    first.sync(harness.snapshot({ documentId: 'src/renamed.ts' }), null)

    expect(recorder.events).toEqual([
      'open:file:///src/index.ts:0:one',
      'close:file:///src/index.ts:0:one',
      'open:file:///src/renamed.ts:0:one',
    ])
    expect(first.activeDocument?.uri).toBe('file:///src/renamed.ts')
    expect(second.activeDocument?.uri).toBe('file:///src/renamed.ts')
  })

  it('cold-opens a different document instead of treating it as a URI transition', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const sync = createSync(workspace, scope)
    sync.sync(new BufferHarness('one').snapshot(), null)

    sync.sync(new BufferHarness('two').snapshot({ documentId: 'src/other.ts' }), null)

    expect(recorder.events).toEqual([
      'open:file:///src/index.ts:0:one',
      'close:file:///src/index.ts:0:one',
      'open:file:///src/other.ts:0:two',
    ])
  })

  it('shares the initiating buffer sync point across a URI transition', () => {
    const workspace = new LspWorkspace()
    const recorder = new SyncTargetRecorder()
    workspace.attachClient(recorder)
    const scope = createDocumentLogicalRevisionScope()
    const harness = new BufferHarness('one')
    const first = createSync(workspace, scope)
    const second = createSync(workspace, scope)
    first.sync(harness.snapshot({ textVersion: 1 }), null)
    second.sync(harness.snapshot({ textVersion: 1 }), null)

    harness.rotateSyncSegment()
    const renamed = harness.snapshot({ documentId: 'src/renamed.ts', textVersion: 1 })
    first.sync(renamed, null)
    second.sync(renamed, null)

    expect(recorder.events).toEqual([
      'open:file:///src/index.ts:0:one',
      'close:file:///src/index.ts:0:one',
      'open:file:///src/renamed.ts:0:one',
    ])
  })

  it.each(['path', 'opaque'])(
    'projects ordered edits across a synchronous URI transition and rollback with %s identities',
    (identity) => {
      const workspace = new LspWorkspace()
      const recorder = new SyncTargetRecorder()
      workspace.attachClient(recorder)
      const scope = createDocumentLogicalRevisionScope()
      const harness = new BufferHarness('one')
      const controller = new LanguageServerDocumentSyncController()
      const ids =
        identity === 'opaque'
          ? { before: '["file","src/index.ts"]', after: '["file","src/renamed.ts"]' }
          : { before: 'src/index.ts', after: 'src/renamed.ts' }
      const uris = new Map([
        [ids.before, 'file:///src/index.ts'],
        [ids.after, 'file:///src/renamed.ts'],
      ])
      const options: LanguageServerDocumentSyncOptions =
        identity === 'opaque'
          ? { uriForDocument: (snapshot) => uris.get(snapshot.documentId ?? '') ?? null }
          : {}
      const first = createSync(workspace, scope, options)
      const second = createSync(workspace, scope, options)
      const rendered = { documentId: ids.before }
      registerMountedObservers(controller, workspace, harness, [first, second], rendered)

      const editOld = harness.ordinary([{ from: 3, to: 3, text: 'A' }])
      syncMountedObservers(first, second, harness, rendered.documentId, editOld)
      controller.transitionDocumentUri({
        fromUri: 'file:///src/index.ts',
        toUri: 'file:///src/renamed.ts',
        textSnapshot: harness.buffer.getTextSnapshot(),
        syncPoint: harness.rotateSyncSegment(),
      })
      const editNew = harness.ordinary([{ from: 4, to: 4, text: 'B' }])
      syncMountedObservers(first, second, harness, rendered.documentId, editNew)

      rendered.documentId = ids.after
      const reverseEditNew = harness.ordinary([{ from: 4, to: 5, text: '' }])
      syncMountedObservers(first, second, harness, rendered.documentId, reverseEditNew)
      controller.transitionDocumentUri({
        fromUri: 'file:///src/renamed.ts',
        toUri: 'file:///src/index.ts',
        textSnapshot: harness.buffer.getTextSnapshot(),
        syncPoint: harness.rotateSyncSegment(),
      })
      const reverseEditOld = harness.ordinary([{ from: 3, to: 4, text: '' }])
      syncMountedObservers(first, second, harness, rendered.documentId, reverseEditOld)

      expect(recorder.events).toEqual([
        'open:file:///src/index.ts:0:one',
        'change:file:///src/index.ts:1:3-3=A',
        'close:file:///src/index.ts:1:oneA',
        'open:file:///src/renamed.ts:0:oneA',
        'change:file:///src/renamed.ts:1:4-4=B',
        'change:file:///src/renamed.ts:2:4-5=',
        'close:file:///src/renamed.ts:2:oneA',
        'open:file:///src/index.ts:2:oneA',
        'change:file:///src/index.ts:3:3-4=',
      ])
    },
  )

  it('filters descriptors and ignores stale diagnostic versions', () => {
    const workspace = new LspWorkspace()
    const presenter = new TestPresenter()
    const scope = createDocumentLogicalRevisionScope()
    const sync = new DocumentSync(workspace, presenter, {
      logicalRevisionScope: scope,
      onDocumentClosed: vi.fn(),
      shouldSyncLanguageId: (languageId) => languageId === 'typescript',
      shouldSyncUri: (uri) => uri.endsWith('.ts'),
    })
    const harness = new BufferHarness('abc')

    sync.sync(harness.snapshot({ languageId: 'markdown' }), null)
    expect(sync.activeDocument).toBeNull()
    sync.sync(harness.snapshot(), null)
    sync.publishDiagnostics({
      uri: 'file:///src/index.ts',
      version: 0,
      diagnostics: [diagnostic(1, 0, 1)],
    })
    sync.publishDiagnostics({
      uri: 'file:///src/index.ts',
      version: 99,
      diagnostics: [diagnostic(2, 1, 2)],
    })

    expect(sync.diagnostics).toHaveLength(1)
    expect(presenter.render).toHaveBeenCalledOnce()
  })
})

class BufferHarness {
  public readonly buffer: EditorTextBuffer
  private readonly session: EditorBufferSession
  private readonly points = new Map<number, ReturnType<EditorTextBuffer['getDocumentSyncPoint']>>()

  public constructor(text: string) {
    this.buffer = createEditorTextBuffer(text)
    this.session = createEditorBufferSession(this.buffer)
    this.rememberPoint()
  }

  public snapshot(
    options: {
      readonly documentId?: string
      readonly languageId?: string
      readonly lineStartsView?: TestLineStartsView
      readonly textVersion?: number
    } = {},
  ): EditorViewSnapshot {
    const point = this.buffer.getDocumentSyncPoint()
    const textSnapshot = this.buffer.getTextSnapshot()
    const fullText = textSnapshot.materializeFullText()
    this.points.set(point.revision, point)
    return {
      documentId: options.documentId ?? 'src/index.ts',
      languageId: options.languageId ?? 'typescript',
      fullText,
      lineStarts: lineStarts(fullText),
      lineStartsView: options.lineStartsView,
      lineCount: lineStarts(fullText).length,
      textVersion: options.textVersion ?? point.textVersion,
      textSnapshot,
      documentSyncPoint: point,
      changesSinceDocumentSyncPoint: (
        from: DocumentSyncPoint,
        scope: DocumentLogicalRevisionScope | null,
      ) => this.buffer.changesSinceDocumentSyncPoint(from, scope),
    } as unknown as EditorViewSnapshot
  }

  public ordinary(edits: readonly TextEdit[]): DocumentSessionChange {
    const change = this.session.applyEdits(edits)
    this.rememberPoint()
    return change
  }

  public workspaceEdit(
    scope: DocumentLogicalRevisionScope,
    logicalRevisionCount: number,
    edits: readonly TextEdit[],
  ): DocumentSessionChange {
    const prepared = prepareDocumentTransaction(this.buffer, edits, logicalRevisionCount, scope)
    const result = commitPreparedDocumentTransaction(
      { buffer: this.buffer, sourceView: this.session.view },
      prepared,
      { history: { kind: 'record' } },
    )
    if (result.status === 'stale') throw new Error('unexpected stale prepared transaction')
    this.rememberPoint()
    return result.change
  }

  public rotateSyncSegment(): DocumentSyncPoint {
    const point = this.buffer.getDocumentSyncPoint()
    const acquired = acquireDocumentMutationLease(
      this.buffer,
      this.buffer.getRevision(),
      this.buffer.getSnapshot(),
      'document-sync-test',
    )
    if (acquired.status !== 'acquired') throw new Error('failed to acquire sync rotation lease')
    const rotated = rotateDocumentSyncSegment(this.buffer, point, acquired.lease)
    if (rotated.status !== 'rotated') throw new Error('failed to rotate document sync segment')
    releaseDocumentMutationLease(this.buffer, acquired.lease)
    this.rememberPoint()
    return rotated.syncPoint
  }

  public point(revision: number): ReturnType<EditorTextBuffer['getDocumentSyncPoint']> {
    const point = this.points.get(revision)
    if (point) return point
    throw new Error(`missing remembered point ${revision}`)
  }

  private rememberPoint(): void {
    const point = this.buffer.getDocumentSyncPoint()
    this.points.set(point.revision, point)
  }
}

class TestPresenter implements DocumentSyncDiagnosticsPresenter {
  public readonly clear = vi.fn()
  public readonly render = vi.fn()
  public readonly publishSummary = vi.fn()
}

class SyncTargetRecorder implements LspWorkspaceSyncTarget {
  public readonly changes: {
    readonly editCount: number
    readonly text: string
    readonly version: number
  }[] = []
  public readonly events: string[] = []

  public didOpenDocument(document: Parameters<LspWorkspaceSyncTarget['didOpenDocument']>[0]): void {
    this.events.push(`open:${document.uri}:${document.version}:${documentText(document)}`)
  }

  public didChangeDocument(
    document: Parameters<LspWorkspaceSyncTarget['didChangeDocument']>[0],
    change: LspDocumentChange,
  ): void {
    this.changes.push({
      editCount: change.edits.length,
      text: documentText(document),
      version: document.version,
    })
    this.events.push(`change:${document.uri}:${document.version}:${editsText(change)}`)
  }

  public didSaveDocument(): void {
    this.events.push('save')
  }

  public didCloseDocument(
    document: Parameters<LspWorkspaceSyncTarget['didCloseDocument']>[0],
  ): void {
    this.events.push(`close:${document.uri}:${document.version}:${documentText(document)}`)
  }
}

function createSync(
  workspace: LspWorkspace,
  logicalRevisionScope: DocumentLogicalRevisionScope,
  options: LanguageServerDocumentSyncOptions = {},
): DocumentSync {
  return new DocumentSync(workspace, new TestPresenter(), {
    ...options,
    logicalRevisionScope,
    onDocumentClosed: vi.fn(),
  })
}

function registerMountedObservers(
  controller: LanguageServerDocumentSyncController,
  workspace: LspWorkspace,
  harness: BufferHarness,
  syncs: readonly DocumentSync[],
  rendered: { documentId: string },
): void {
  for (const sync of syncs) {
    controller.register({
      getSnapshot: () => harness.snapshot({ documentId: rendered.documentId }),
      sync,
      workspace,
    })
    sync.sync(harness.snapshot({ documentId: rendered.documentId }), null)
  }
}

function syncMountedObservers(
  first: DocumentSync,
  second: DocumentSync,
  harness: BufferHarness,
  documentId: string,
  change: DocumentSessionChange,
): void {
  first.sync(harness.snapshot({ documentId }), change)
  second.sync(harness.snapshot({ documentId }), change)
}

function syncPointAtOpen(
  harness: BufferHarness,
  revision: number,
): ReturnType<EditorTextBuffer['getDocumentSyncPoint']> {
  return harness.point(revision)
}

function lineStarts(text: string): readonly number[] {
  const starts = [0]
  let index = text.indexOf('\n')
  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }
  return starts
}

function lineStartsView(text: string): TestLineStartsView {
  const starts = lineStarts(text)
  return {
    length: starts.length,
    at: (index) => starts[index],
    indexForOffset: (offset) => rowForOffset(starts, offset),
    firstIndexAtOrAfter: (offset) => starts.findIndex((start) => start >= offset),
    toArray: () => starts,
  }
}

function rowForOffset(starts: readonly number[], offset: number): number {
  let row = 0
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index]! > offset) break
    row = index
  }
  return row
}

function editsText(change: LspDocumentChange): string {
  if (change.edits.length === 0) return 'full'
  return change.edits.map((edit) => `${edit.from}-${edit.to}=${edit.text}`).join(',')
}

function diagnostic(severity: lsp.DiagnosticSeverity, start: number, end: number): lsp.Diagnostic {
  return {
    severity,
    message: 'message',
    range: {
      start: { line: 0, character: start },
      end: { line: 0, character: end },
    },
  }
}

function documentText(document: { readonly textSnapshot: LspTextSnapshot }): string {
  return document.textSnapshot.readRange(0, document.textSnapshot.length)
}
