import { expect, test } from 'vitest'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { arrayLspLineStarts } from '@singapore-editor/lsp'
import { acquireResolvedLanguageServerLane } from '../src/lane'
import { LanguageServerSet } from '../src/serverSet'

async function laneFixture(id: string) {
  const handlers = new Set<(frame: string) => void>()
  const frames: Record<string, unknown>[] = []
  const prepares: string[] = []
  const lane = acquireResolvedLanguageServerLane({
    id,
    features: { codeActions: 0 },
    rootUri: null,
    createTransport: () => ({
      subscribe: (handler) => {
        handlers.add(handler)
      },
      unsubscribe: (handler) => {
        handlers.delete(handler)
      },
      onDidClose: () => () => undefined,
      close: () => handlers.clear(),
      send(value) {
        const frame: unknown = JSON.parse(value)
        if (!isRecord(frame) || !('id' in frame)) return
        frames.push(frame)
        const result =
          frame.method === 'initialize'
            ? { capabilities: { codeActionProvider: true, textDocumentSync: 2 } }
            : [{ title: id, edit: { changes: {} } }]
        queueMicrotask(() => {
          for (const handler of handlers)
            handler(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
        })
      },
    }),
  })
  await lane.ready
  const releases = ['file:///a.ts', 'file:///b.ts'].map((uri) => {
    const buffer = createEditorTextBuffer('abc')
    const point = buffer.getDocumentSyncPoint()
    const opened = lane.workspace.openDocumentSnapshot({
      uri,
      languageId: 'typescript',
      textSnapshot: buffer.getTextSnapshot(),
      lineStarts: arrayLspLineStarts([0]),
      sourceRevision: point.revision,
      sourceSegment: point.segment,
    })
    return lane.workspace.registerDocumentSource({
      uri,
      runtimeSessionId: uri,
      prepare: () => {
        prepares.push(uri)
        return {
          document: opened.document,
          isCurrent: () => lane.workspace.getDocument(uri)?.sourceSegment === point.segment,
        }
      },
    })
  })
  return {
    lane,
    frames,
    prepares,
    dispose: () => {
      for (const release of releases) release()
      lane.release()
    },
  }
}

test.each([1, 2])(
  'code actions capture one params frame for provenance and all %i real lane requests',
  async (count) => {
    const fixtures = await Promise.all(
      Array.from({ length: count }, (_, index) => laneFixture(String(index))),
    )
    let accesses = 0
    const params = {
      get textDocument() {
        accesses++
        return { uri: accesses % 2 ? 'file:///a.ts' : 'file:///b.ts' }
      },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      context: { diagnostics: [] },
    }
    const servers = new LanguageServerSet(
      fixtures.map(({ lane }) => ({ id: lane.id, features: { codeActions: 0 }, connection: lane })),
    )
    try {
      const actions = await servers.request<readonly { title: string }[]>(
        'textDocument/codeAction',
        params,
      )
      expect(accesses).toBe(1)
      expect(actions).toHaveLength(count)
      for (const fixture of fixtures) {
        expect(fixture.prepares).toEqual(['file:///a.ts', 'file:///a.ts'])
        expect(fixture.frames.at(-1)?.params).toMatchObject({
          textDocument: { uri: 'file:///a.ts' },
        })
      }
      for (const action of actions)
        expect(servers.provenanceOf(action)?.guard.isCurrent('file:///a.ts')).toBe(true)
    } finally {
      for (const fixture of fixtures) fixture.dispose()
    }
  },
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
