import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
  createEditorTextBuffer,
  createEditorBufferSession,
  prepareDocumentTransaction,
  commitPreparedDocumentTransaction,
} from '@singapore-editor/core/document'
import { createLanguageServerDocument } from '../src/document'
import { LanguageServerDocumentSyncController } from '../src/documentSyncController'
import { LspConnectionPool } from '../src/lspConnectionPool'

class ProtocolSocket extends EventTarget {
  static instances: ProtocolSocket[] = []
  readonly sent: Record<string, unknown>[] = []
  readyState = 0
  constructor(_url: string | URL, _protocols?: string | readonly string[]) {
    super()
    ProtocolSocket.instances.push(this)
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    })
  }
  send(value: string): void {
    const message: unknown = JSON.parse(value)
    if (!isRecord(message)) expect.unreachable('Protocol frame must be an object')
    this.sent.push(message)
    if (typeof message.id !== 'number' && typeof message.id !== 'string') return
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result:
              message.method === 'initialize'
                ? {
                    capabilities: {
                      textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
                    },
                  }
                : null,
          }),
        }),
      ),
    )
  }
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}
const pools: LspConnectionPool[] = []
afterEach(() => {
  for (const pool of pools.splice(0)) pool.dispose()
  ProtocolSocket.instances = []
})

function fixture(text = 'one') {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const pool = new LspConnectionPool()
  pools.push(pool)
  const controller = new LanguageServerDocumentSyncController()
  const create = (id = 'typescript', pooled = true, save = false) =>
    createLanguageServerDocument({
      buffer,
      uri: 'file:///src/index.ts',
      languageId: 'typescript',
      controller,
      lanes: [
        {
          id,
          features: {},
          webSocketRoute: 'ws://fixture/lsp',
          ...(save
            ? { capabilities: { textDocument: { synchronization: { didSave: true } } } }
            : {}),
          webSocketTransportOptions: { WebSocketCtor: ProtocolSocket },
          ...(pooled ? { connectionProvider: pool.provider(id) } : {}),
        },
      ],
    })
  return { buffer, view, pool, controller, create }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function notifications(method: string) {
  return ProtocolSocket.instances.flatMap((socket) =>
    socket.sent.filter((message) => message.method === method),
  )
}
function documentParam(message: Record<string, unknown>): Record<string, unknown> {
  const params = message.params
  if (!isRecord(params) || !isRecord(params.textDocument))
    expect.unreachable('Missing textDocument')
  return params.textDocument
}
function lane(document: ReturnType<ReturnType<typeof fixture>['create']>) {
  const first = document.lanes[0]
  if (!first) expect.unreachable('Fixture needs a lane')
  return first
}

function workspaceEdit(
  f: ReturnType<typeof fixture>,
  document: ReturnType<typeof f.create>,
  count: number,
  text: string,
) {
  const prepared = prepareDocumentTransaction(
    f.buffer,
    [{ from: 0, to: f.buffer.getTextSnapshot().length, text }],
    count,
    lane(document).connection.logicalRevisionScope,
  )
  const committed = commitPreparedDocumentTransaction(
    { buffer: f.buffer, sourceView: f.view.view },
    prepared,
    { history: { kind: 'record' } },
  )
  if (committed.status === 'stale') expect.unreachable('Fixture transaction must commit')
}

describe('retained public language-server documents', () => {
  it('uses the encoded frame URI for source preparation with a mutable getter', async () => {
    const f = fixture('one')
    const document = f.create()
    try {
      await lane(document).connection.ready
      const socket = ProtocolSocket.instances[0]
      if (!socket) expect.unreachable('Socket required')
      const from = socket.sent.length
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      let reads = 0
      const params = {
        get textDocument() {
          reads++
          return { uri: reads === 1 ? 'file:///src/index.ts' : 'file:///other.ts' }
        },
      }
      await lane(document).connection.client.request('textDocument/hover', params)
      expect(reads).toBe(1)
      expect(socket.sent.slice(from).map((message) => message.method)).toEqual([
        'textDocument/didChange',
        'textDocument/hover',
      ])
      expect(notifications('textDocument/hover')[0]?.params).toEqual({
        textDocument: { uri: 'file:///src/index.ts' },
      })
    } finally {
      document.dispose()
    }
  })
  it('keeps prepared source provenance immutable and detects later publication or retirement', async () => {
    const f = fixture('one')
    const document = f.create()
    try {
      await lane(document).connection.ready
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      const prepared =
        lane(document).connection.workspace.prepareDocumentRequest('file:///src/index.ts')
      if (prepared.kind !== 'pending') expect.unreachable('Edited source must be pending')
      const read = await prepared.ready
      expect(read.document.sourceRevision).toBe(1)
      expect(read.document.textSnapshot.readRange(0, 4)).toBe('one!')
      expect(read.isCurrent()).toBe(true)
      f.view.applyEdits([{ from: 4, to: 4, text: '?' }])
      await expect.poll(() => lane(document).sync.activeDocument?.sourceRevision).toBe(2)
      expect(read.isCurrent()).toBe(false)
      expect(read.document.sourceRevision).toBe(1)
      expect(read.document.textSnapshot.readRange(0, 4)).toBe('one!')
      document.dispose()
      expect(read.isCurrent()).toBe(false)
    } finally {
      document.dispose()
    }
  })
  it('keeps request URI and position captured before source readiness', async () => {
    const f = fixture('one')
    const document = f.create()
    try {
      await lane(document).connection.ready
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      const params = {
        textDocument: { uri: 'file:///src/index.ts' },
        position: { line: 0, character: 4 },
      }
      const request = lane(document).connection.client.request('textDocument/hover', params)
      params.textDocument.uri = 'file:///other.ts'
      params.position.character = 99
      await request
      expect(notifications('textDocument/hover')[0]?.params).toEqual({
        textDocument: { uri: 'file:///src/index.ts' },
        position: { line: 0, character: 4 },
      })
    } finally {
      document.dispose()
    }
  })

  it('saves the accepted current source after its pending change', async () => {
    const f = fixture('one')
    const document = f.create('typescript', true, true)
    try {
      await lane(document).connection.ready
      const socket = ProtocolSocket.instances[0]
      if (!socket) expect.unreachable('Socket required')
      const from = socket.sent.length
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      await lane(document).connection.workspace.saveDocument('file:///src/index.ts')
      expect(socket.sent.slice(from).map((frame) => frame.method)).toEqual([
        'textDocument/didChange',
        'textDocument/didSave',
      ])
      expect(notifications('textDocument/didSave')[0]?.params).toMatchObject({ text: 'one!' })
    } finally {
      document.dispose()
    }
  })
  it('delivers the newest retained source before a text-document request', async () => {
    const f = fixture('one')
    const document = f.create()
    try {
      await lane(document).connection.ready
      const socket = ProtocolSocket.instances[0]
      if (!socket) expect.unreachable('Fixture socket required')
      const from = socket.sent.length
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      await lane(document).connection.client.request('textDocument/hover', {
        textDocument: { uri: 'file:///src/index.ts' },
        position: { line: 0, character: 4 },
      })
      await expect.poll(() => lane(document).sync.activeDocument?.lspVersion).toBe(1)
      expect(socket.sent.slice(from).map((message) => message.method)).toEqual([
        'textDocument/didChange',
        'textDocument/hover',
      ])
    } finally {
      document.dispose()
    }
  })

  it('keeps a waiting request alive through another shared peer retirement', async () => {
    const f = fixture('one')
    const first = f.create()
    const second = f.create()
    try {
      await Promise.all([lane(first).connection.ready, lane(second).connection.ready])
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      const request = lane(second).connection.client.request('textDocument/hover', {
        textDocument: { uri: 'file:///src/index.ts' },
      })
      first.dispose()
      await request
      expect(lane(second).sync.activeDocument?.lspVersion).toBe(1)
      expect(notifications('textDocument/hover')).toHaveLength(1)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it.each(['final-release', 'disconnect', 'caller-cancel'] as const)(
    'rejects %s during source readiness without sending a request',
    async (kind) => {
      const f = fixture('one')
      const document = f.create()
      try {
        await lane(document).connection.ready
        f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
        const handle = lane(document).connection.client.requestHandle('textDocument/hover', {
          textDocument: { uri: 'file:///src/index.ts' },
        })
        const rejection = expect(handle.response).rejects.toBeDefined()
        if (kind === 'final-release') document.dispose()
        if (kind === 'disconnect') ProtocolSocket.instances[0]?.close()
        if (kind === 'caller-cancel') handle.cancel()
        await rejection
        expect(notifications('textDocument/hover')).toEqual([])
        if (kind === 'caller-cancel')
          await expect.poll(() => lane(document).sync.activeDocument?.lspVersion).toBe(1)
      } finally {
        document.dispose()
      }
    },
  )
  it('delivers initial source and automatic scoped publications through the real client', async () => {
    const f = fixture()
    const document = f.create()
    try {
      await lane(document).connection.ready
      expect(documentParam(notifications('textDocument/didOpen')[0]!)).toMatchObject({
        text: 'one',
        version: 0,
      })
      workspaceEdit(f, document, 4, 'two')
      await expect.poll(() => lane(document).sync.activeDocument?.lspVersion).toBe(4)
      workspaceEdit(f, document, 3, 'twoX')
      f.view.applyEdits([{ from: 4, to: 4, text: 'Y' }])
      await expect.poll(() => lane(document).sync.activeDocument?.lspVersion).toBe(8)
      expect(
        notifications('textDocument/didChange')
          .map(documentParam)
          .map((doc) => doc.version),
      ).toEqual([4, 8])
      expect(lane(document).sync.activeDocument?.textSnapshot.readRange(0, 5)).toBe('twoXY')
    } finally {
      document.dispose()
    }
  })

  it('shares one source attachment and retires only the final compatible peer', async () => {
    const f = fixture('shared')
    const first = f.create()
    const second = f.create()
    try {
      await Promise.all([lane(first).connection.ready, lane(second).connection.ready])
      expect(ProtocolSocket.instances).toHaveLength(1)
      expect(notifications('textDocument/didOpen')).toHaveLength(1)
      first.dispose()
      f.view.applyEdits([{ from: 6, to: 6, text: '!' }])
      await expect.poll(() => lane(second).sync.activeDocument?.lspVersion).toBe(1)
      expect(notifications('textDocument/didClose')).toHaveLength(0)
      second.dispose()
      expect(notifications('textDocument/didClose')).toHaveLength(1)
      expect(lane(second).connection.workspace.documents).toEqual([])
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('keeps two server scopes independent for text and logical-only workspace edits', async () => {
    const f = fixture()
    const first = f.create('server-a')
    const second = f.create('server-b')
    try {
      await Promise.all([lane(first).connection.ready, lane(second).connection.ready])
      workspaceEdit(f, first, 4, 'two')
      await expect.poll(() => lane(first).sync.activeDocument?.lspVersion).toBe(4)
      await expect.poll(() => lane(second).sync.activeDocument?.lspVersion).toBe(1)
      workspaceEdit(f, first, 2, 'two')
      await expect.poll(() => lane(first).sync.activeDocument?.lspVersion).toBe(6)
      await expect
        .poll(() => lane(second).sync.activeDocument?.sourceRevision)
        .toBe(f.buffer.getRevision())
      expect(lane(second).sync.activeDocument?.lspVersion).toBe(1)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('rebinds every shared URI peer from the actual rotated canonical source', async () => {
    const f = fixture()
    const first = f.create()
    const second = f.create()
    try {
      await Promise.all([lane(first).connection.ready, lane(second).connection.ready])
      const previousSyncPoint = f.buffer.getDocumentSyncPoint()
      const acquired = acquireDocumentMutationLease(
        f.buffer,
        f.buffer.getRevision(),
        f.buffer.getSnapshot(),
        'fixture',
      )
      if (acquired.status !== 'acquired') expect.unreachable('Rotation lease required')
      const rotated = rotateDocumentSyncSegment(f.buffer, previousSyncPoint, acquired.lease)
      releaseDocumentMutationLease(f.buffer, acquired.lease)
      if (rotated.status !== 'rotated') expect.unreachable('Rotation must succeed')
      f.controller.transitionDocumentUri({
        fromUri: 'file:///src/index.ts',
        toUri: 'file:///src/renamed.ts',
        previousSyncPoint,
        syncPoint: rotated.syncPoint,
      })
      await expect.poll(() => lane(first).sync.activeDocument?.uri).toBe('file:///src/renamed.ts')
      await expect.poll(() => lane(second).sync.activeDocument?.uri).toBe('file:///src/renamed.ts')
      expect(lane(first).connection.workspace.documents.map((doc) => doc.uri)).toEqual([
        'file:///src/renamed.ts',
      ])
      expect(notifications('textDocument/didClose')).toHaveLength(1)
      expect(notifications('textDocument/didOpen')).toHaveLength(2)
      f.view.applyEdits([{ from: 3, to: 3, text: '!' }])
      await expect.poll(() => lane(first).sync.activeDocument?.lspVersion).toBe(1)
      expect(documentParam(notifications('textDocument/didChange')[0]!)).toMatchObject({
        uri: 'file:///src/renamed.ts',
        version: 1,
      })
      const previous = f.buffer.getDocumentSyncPoint()
      const held = acquireDocumentMutationLease(
        f.buffer,
        f.buffer.getRevision(),
        f.buffer.getSnapshot(),
        'fixture',
      )
      if (held.status !== 'acquired') expect.unreachable('Second rotation lease required')
      const moved = rotateDocumentSyncSegment(f.buffer, previous, held.lease)
      releaseDocumentMutationLease(f.buffer, held.lease)
      if (moved.status !== 'rotated') expect.unreachable('Second rotation must succeed')
      f.controller.transitionDocumentUri({
        fromUri: 'file:///src/renamed.ts',
        toUri: 'file:///src/index.ts',
        previousSyncPoint: previous,
        syncPoint: moved.syncPoint,
      })
      await expect.poll(() => lane(first).sync.activeDocument?.uri).toBe('file:///src/index.ts')
      f.view.applyEdits([{ from: 4, to: 4, text: '?' }])
      await expect.poll(() => lane(first).sync.activeDocument?.lspVersion).toBe(2)
      expect(lane(first).connection.workspace.documents.map((doc) => doc.uri)).toEqual([
        'file:///src/index.ts',
      ])
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it.each(['ordinary', 'scoped'] as const)(
    'starts an honest wire epoch after %s history expires',
    async (kind) => {
      const f = fixture('a')
      const document = f.create()
      try {
        await lane(document).connection.ready
        if (kind === 'scoped') workspaceEdit(f, document, 4, 'aW')
        for (let index = 0; index < 129; index++) {
          const end = f.buffer.getTextSnapshot().length
          f.view.applyEdits([{ from: end, to: end, text: 'x' }])
        }
        await expect
          .poll(() => lane(document).sync.activeDocument?.sourceRevision)
          .toBe(f.buffer.getRevision())
        expect(notifications('textDocument/didChange')).toEqual([])
        expect(notifications('textDocument/didClose')).toHaveLength(1)
        expect(
          notifications('textDocument/didOpen')
            .map(documentParam)
            .map((doc) => doc.version),
        ).toEqual([0, 1])
        const text = 'a' + (kind === 'scoped' ? 'W' : '') + 'x'.repeat(129)
        expect(documentParam(notifications('textDocument/didOpen')[1]!).text).toBe(text)
      } finally {
        document.dispose()
      }
    },
  )

  it('cancels socket startup before any source work and leaves no protocol document', async () => {
    const f = fixture()
    const document = f.create('typescript', false)
    document.dispose()
    await expect
      .poll(() => ProtocolSocket.instances.every((socket) => socket.readyState === 3))
      .toBe(true)
    expect(notifications('textDocument/didOpen')).toEqual([])
    expect(notifications('initialize')).toEqual([])
    expect(lane(document).connection.workspace.documents).toEqual([])
    expect(ProtocolSocket.instances.every((socket) => socket.readyState === 3)).toBe(true)
  })

  it.each([2, 3])(
    'releases the ready source after socket state %i before its delayed close event',
    async (state) => {
      const f = fixture()
      const document = f.create('closing', false)
      const lane = document.lanes[0]!
      await lane.connection.ready
      const socket = ProtocolSocket.instances.at(-1)!
      const frames = socket.sent.length
      socket.readyState = state
      expect(() => document.dispose()).not.toThrow()
      expect(lane.connection.workspace.documents).toEqual([])
      expect(socket.sent).toHaveLength(frames)
      socket.dispatchEvent(new Event('close'))
      expect(() => document.dispose()).not.toThrow()
    },
  )
})
