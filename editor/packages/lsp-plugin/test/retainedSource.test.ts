import {
  commitPreparedDocumentTransaction,
  createDocumentLogicalRevisionScope,
  createEditorBufferSession,
  createEditorTextBuffer,
  prepareDocumentTransaction,
  type DocumentLogicalRevisionScope,
  type TextEdit,
} from '@singapore-editor/core/document'
import {
  LspWorkspace,
  type LspDocument,
  type LspDocumentChange,
  type LspWorkspaceSyncTarget,
} from '@singapore-editor/lsp'
import { describe, expect, it } from 'vitest'
import { retainLanguageServerSource } from '../src/retainedSource'
import type { LanguageServerSourceConnection } from '../src/retainedSource'
import { captureWorkspaceEditOriginGuard } from '../src/serverSet'
import { prepareWorkspaceTextReplay } from '../src/workspaceTextEdits'

describe('retained language-server source', () => {
  it('accepts captured canonical dirty provenance and rejects its edited source', async () => {
    const fixture = createFixture('dirty')
    try {
      await fixture.source.request()
      const guard = captureWorkspaceEditOriginGuard(fixture.workspace)
      expect(guard.documents[0]?.textSnapshot).not.toBe(fixture.buffer.getTextSnapshot())
      const replay = () =>
        prepareWorkspaceTextReplay({
          logicalRevisionScope: fixture.scope,
          provenance: guard.documents,
          target: {
            buffer: fixture.buffer,
            initialSnapshot: fixture.buffer.getTextSnapshot(),
            expectedRevision: fixture.buffer.getRevision(),
            initialSyncPoint: fixture.buffer.getDocumentSyncPoint(),
          },
          segments: [
            {
              segmentIndex: 0,
              uri: 'file:///src/index.ts',
              operations: [
                {
                  operationIndex: 0,
                  operation: {
                    kind: 'text-document',
                    uri: 'file:///src/index.ts',
                    version: 0,
                    edits: [
                      {
                        newText: 'D',
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        })
      expect(replay()).toMatchObject({ ok: true })
      fixture.view.applyEdits([{ from: 5, to: 5, text: '!' }])
      expect(replay()).toMatchObject({ ok: false, error: { code: 'version-mismatch' } })
      await fixture.source.request()
      expect(guard.isCurrent('file:///src/index.ts')).toBe(false)
      expect(guard.documents[0]?.sourceRevision).toBe(0)
      expect(fixture.source.current()?.sourceRevision).toBe(1)
    } finally {
      fixture.dispose()
    }
  })

  it('keeps a waiting immutable source paired with its original provenance', async () => {
    let arrive = () => {}
    let waiting = () => {}
    const observed = new Promise<void>((resolve) => {
      waiting = resolve
    })
    const ready = new Promise<void>((resolve) => {
      arrive = resolve
    })
    const fixture = createFixture('old', {
      generation: 1,
      isCurrent: () => true,
      get ready() {
        waiting()
        return ready
      },
    })
    try {
      const first = fixture.source.request()
      const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' })
      await observed
      fixture.view.applyEdits([{ from: 0, to: 3, text: 'new' }])
      await rejection
      arrive()
      await fixture.source.request()
      expect(fixture.recorder.events).toEqual(['open:0:old', 'change:1:new'])
      expect(
        fixture.recorder.documents.map((document) => [
          document.sourceRevision,
          document.textSnapshot.readRange(0, 3),
        ]),
      ).toEqual([
        [0, 'old'],
        [1, 'new'],
      ])
    } finally {
      arrive()
      fixture.dispose()
    }
  })
  it('delivers scoped atomic4 and deferred3 plus ordinary1 through canonical ownership', async () => {
    const fixture = createFixture('abc')
    try {
      await fixture.source.request()
      fixture.workspaceEdit(4, [{ from: 0, to: 3, text: 'two' }])
      await fixture.source.request()
      expect(fixture.source.current()?.version).toBe(4)
      fixture.workspaceEdit(3, [{ from: 3, to: 3, text: 'X' }])
      fixture.view.applyEdits([{ from: 4, to: 4, text: 'Y' }])
      await fixture.source.request()
      expect(fixture.source.current()?.version).toBe(8)
      expect(fixture.recorder.events).toEqual(['open:0:abc', 'change:4:two', 'change:8:twoXY'])
    } finally {
      fixture.dispose()
    }
  })

  it('keeps logical-only and non-originating server versions independent', async () => {
    const fixture = createFixture('one')
    const peerWorkspace = new LspWorkspace()
    const recorder = new ProtocolRecorder()
    peerWorkspace.attachClient(recorder)
    const peer = retainLanguageServerSource({
      buffer: fixture.buffer,
      uri: 'file:///src/index.ts',
      languageId: 'typescript',
      workspace: peerWorkspace,
      logicalRevisionScope: createDocumentLogicalRevisionScope(),
      connection: fixture.connection,
    })
    if (!peer) expect.unreachable('Peer source is required')
    try {
      await Promise.all([fixture.source.request(), peer.request()])
      fixture.workspaceEdit(3, [{ from: 0, to: 3, text: 'two' }])
      await Promise.all([fixture.source.request(), peer.request()])
      const guard = captureWorkspaceEditOriginGuard(peerWorkspace)
      fixture.workspaceEdit(2, [{ from: 0, to: 3, text: 'two' }])
      await Promise.all([fixture.source.request(), peer.request()])
      expect(fixture.source.current()?.version).toBe(5)
      expect(peer.current()?.version).toBe(1)
      expect(guard.isCurrent('file:///src/index.ts')).toBe(false)
      expect(recorder.events).toEqual(['open:0:one', 'change:1:two'])
      fixture.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      await Promise.all([fixture.source.request(), peer.request()])
      expect(peer.current()?.version).toBe(2)
    } finally {
      peer.dispose()
      fixture.dispose()
    }
  })

  it.each(['ordinary', 'scoped'] as const)(
    'starts an explicit protocol epoch after a %s history gap',
    async (kind) => {
      const fixture = createFixture('a')
      try {
        await fixture.source.request()
        if (kind === 'scoped') fixture.workspaceEdit(4, [{ from: 1, to: 1, text: 'W' }])
        for (let index = 0; index < 129; index++) {
          const end = fixture.buffer.getTextSnapshot().length
          fixture.view.applyEdits([{ from: end, to: end, text: 'x' }])
        }
        await fixture.source.request()
        const expected = 'a' + (kind === 'scoped' ? 'W' : '') + 'x'.repeat(129)
        expect(fixture.recorder.events).toEqual(['open:0:a', 'close:0:a', `open:1:${expected}`])
        expect(fixture.source.current()?.version).toBe(1)
        expect(fixture.source.current()?.textSnapshot.readRange(0, expected.length)).toBe(expected)
        const end = fixture.buffer.getTextSnapshot().length
        fixture.view.applyEdits([{ from: end, to: end, text: '!' }])
        await fixture.source.request()
        expect(fixture.source.current()?.version).toBe(2)
      } finally {
        fixture.dispose()
      }
    },
  )

  it('shares one protocol attachment between interests and retires only its final peer', async () => {
    const fixture = createFixture('shared')
    const peer = retainLanguageServerSource({
      buffer: fixture.buffer,
      workspace: fixture.workspace,
      uri: 'file:///src/index.ts',
      languageId: 'typescript',
      logicalRevisionScope: fixture.scope,
      connection: fixture.connection,
    })
    if (!peer) expect.unreachable('Shared interest is required')
    try {
      await Promise.all([fixture.source.request(), peer.request()])
      expect(fixture.recorder.events).toEqual(['open:0:shared'])
      fixture.source.dispose()
      expect(fixture.source.current()).toBeNull()
      expect(fixture.workspace.documents).toHaveLength(1)
      fixture.view.applyEdits([{ from: 6, to: 6, text: '!' }])
      await peer.request()
      expect(peer.current()?.version).toBe(1)
      peer.dispose()
      expect(fixture.workspace.documents).toHaveLength(0)
      expect(fixture.recorder.events.at(-1)).toBe('close:1:shared!')
    } finally {
      peer.dispose()
      fixture.dispose()
    }
  })

  it('does not open from a canceled readiness wait after its connection arrives', async () => {
    let arrive = () => {}
    const ready = new Promise<void>((resolve) => {
      arrive = resolve
    })
    const connection = { generation: 1, ready, isCurrent: () => true }
    const fixture = createFixture('late', connection)
    const request = fixture.source.request()
    fixture.source.dispose()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    arrive()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.recorder.events).toEqual([])
    expect(fixture.workspace.documents).toEqual([])
  })

  it('rejects a retired connection epoch and opens the latest source in its replacement', async () => {
    let current = true
    let arrive = () => {}
    const ready = new Promise<void>((resolve) => {
      arrive = resolve
    })
    const fixture = createFixture('old', { generation: 1, ready, isCurrent: () => current })
    const request = fixture.source.request()
    await Promise.resolve()
    current = false
    arrive()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.recorder.events).toEqual([])
    fixture.source.dispose()
    fixture.view.applyEdits([{ from: 0, to: 3, text: 'new' }])
    const replacement = retainLanguageServerSource({
      buffer: fixture.buffer,
      workspace: fixture.workspace,
      logicalRevisionScope: fixture.scope,
      uri: 'file:///src/index.ts',
      languageId: 'typescript',
      connection: { generation: 2, ready: Promise.resolve(), isCurrent: () => true },
    })
    if (!replacement) expect.unreachable('Replacement source is required')
    try {
      await replacement.request()
      expect(replacement.current()?.textSnapshot.readRange(0, 3)).toBe('new')
      expect(fixture.recorder.events).toEqual(['open:0:new'])
    } finally {
      replacement.dispose()
    }
  })

  it('does not ACK a failed delivery and composes the next source from the accepted base', async () => {
    const fixture = createFixture('a')
    try {
      await fixture.source.request()
      fixture.recorder.failChange = true
      fixture.view.applyEdits([{ from: 1, to: 1, text: 'X' }])
      await expect(fixture.source.request()).rejects.toMatchObject({ name: 'NetworkError' })
      expect(fixture.workspace.getDocument('file:///src/index.ts')?.version).toBe(0)
      expect(fixture.source.current()).toBeNull()
      fixture.recorder.failChange = false
      fixture.view.applyEdits([{ from: 2, to: 2, text: 'Y' }])
      await fixture.source.request()
      expect(fixture.recorder.events).toEqual(['open:0:a', 'change:2:aXY'])
      expect(fixture.recorder.changes.at(-1)?.edits).toEqual([{ from: 1, to: 1, text: 'XY' }])
    } finally {
      fixture.dispose()
    }
  })

  it('releases its canonical interest even when final protocol close fails', async () => {
    const fixture = createFixture('close')
    await fixture.source.request()
    fixture.recorder.failClose = true
    expect(() => fixture.source.dispose()).toThrow()
    expect(fixture.workspace.documents).toEqual([])
    expect(fixture.source.current()).toBeNull()
    expect(() => fixture.source.dispose()).not.toThrow()
    fixture.view.applyEdits([{ from: 5, to: 5, text: '!' }])
    await Promise.resolve()
    expect(fixture.recorder.events).toEqual(['open:0:close'])
  })
})

function createFixture(
  text: string,
  connection: LanguageServerSourceConnection = {
    generation: 1,
    ready: Promise.resolve(),
    isCurrent: () => true,
  },
) {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const workspace = new LspWorkspace()
  const recorder = new ProtocolRecorder()
  workspace.attachClient(recorder)
  const scope = createDocumentLogicalRevisionScope()
  const source = retainLanguageServerSource({
    buffer,
    workspace,
    logicalRevisionScope: scope,
    uri: 'file:///src/index.ts',
    languageId: 'typescript',
    connection,
  })
  if (!source) expect.unreachable('Retained source is required')
  return {
    buffer,
    view,
    workspace,
    recorder,
    scope,
    source,
    connection,
    workspaceEdit(count: number, edits: readonly TextEdit[]) {
      applyWorkspace(buffer, view, scope, count, edits)
    },
    dispose: () => source.dispose(),
  }
}

function applyWorkspace(
  buffer: ReturnType<typeof createEditorTextBuffer>,
  view: ReturnType<typeof createEditorBufferSession>,
  scope: DocumentLogicalRevisionScope,
  count: number,
  edits: readonly TextEdit[],
) {
  const prepared = prepareDocumentTransaction(buffer, edits, count, scope)
  const result = commitPreparedDocumentTransaction({ buffer, sourceView: view.view }, prepared, {
    history: { kind: 'record' },
  })
  if (result.status === 'stale') expect.unreachable('Workspace fixture must commit')
}

class ProtocolRecorder implements LspWorkspaceSyncTarget {
  readonly events: string[] = []
  readonly changes: LspDocumentChange[] = []
  readonly documents: LspDocument[] = []
  failChange = false
  failClose = false
  didOpenDocument(document: LspDocument): void {
    this.documents.push(document)
    this.events.push(
      `open:${document.version}:${document.textSnapshot.readRange(0, document.textSnapshot.length)}`,
    )
  }
  didChangeDocument(document: LspDocument, _change: LspDocumentChange): void {
    if (this.failChange) throw new DOMException('Fixture change send failed', 'NetworkError')
    this.changes.push(_change)
    this.documents.push(document)
    this.events.push(
      `change:${document.version}:${document.textSnapshot.readRange(0, document.textSnapshot.length)}`,
    )
  }
  didCloseDocument(document: LspDocument): void {
    if (this.failClose) throw new DOMException('Fixture close send failed', 'NetworkError')
    this.events.push(
      `close:${document.version}:${document.textSnapshot.readRange(0, document.textSnapshot.length)}`,
    )
  }
  didSaveDocument(): void {}
}
