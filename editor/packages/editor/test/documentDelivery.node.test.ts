import { createDocumentLogicalRevisionScope } from '../src/editor/editChain'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import { defineHighlighterOperation } from '../src/editor/operationDefinitions'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { expect, it } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  commitPreparedDocumentTransaction,
  prepareDocumentTransaction,
} from '../src/documentSession'
import {
  DocumentDelivery,
  type DocumentSourceConnection,
  type DocumentSourceEndpoint,
  type DocumentProjectionEndpoint,
  type DocumentProjectionUpdate,
} from '../src/editor/documentDelivery'
import {
  DocumentWorkerReader,
  type DocumentWorkerSourceCommand,
} from '../src/document/workerReader'

function ownedHighlighter(
  source: ReturnType<typeof endpoint>,
  dispose: () => void,
  unsubscribe: () => void,
) {
  return {
    operation: defineHighlighterOperation((context) => ({
      analyze: async (read) => {
        const loan = await context.source.prepareReader(source.transport, read)
        await loan?.dispose()
        return { tokens: EditorTokenStore.empty() }
      },
      onDidChangeTheme: () => unsubscribe,
      dispose,
    })),
  }
}

it.each(['owner', 'inactive'] as const)(
  'releases all live readers before reporting a failing %s theme cleanup',
  async (boundary) => {
    const buffer = createEditorTextBuffer('owned')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'cleanup' })
    const sources = [endpoint(), endpoint()]
    const disposed = [0, 0]
    const failure = new TypeError('Controlled unsubscribe failure')
    const fail = () => {
      throw failure
    }
    const providers = sources.map((source, index) =>
      ownedHighlighter(
        source,
        () => {
          disposed[index]++
        },
        index === 0 ? fail : () => {},
      ),
    )
    const leases = providers.map((provider) =>
      analysis.borrowHighlighter({ provider, languageId: 'fixture' })!,
    )
    await Promise.all(leases.map((lease) => lease.refresh(buffer.getTextSnapshot())))
    expect(sources.map((source) => source.reader.inspect().documents)).toEqual([1, 1])
    for (const lease of leases) lease.dispose()
    try {
      expect(() =>
        boundary === 'owner'
          ? analysis.dispose()
          : analysis.reclaimInactive({ reason: 'inactive-budget' }),
      ).toThrow(failure)
      expect(disposed).toEqual([1, 1])
      for (const source of sources)
        expect(source.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
    } finally {
      analysis.dispose()
      for (const source of sources) source.reader.dispose()
    }
  },
)

function endpoint() {
  const reader = new DocumentWorkerReader()
  let registration = 0
  const commands: DocumentWorkerSourceCommand[] = []
  const connection: DocumentSourceConnection = {
    generation: 1,
    nextRegistration: () => ++registration,
    send: async (command) => {
      commands.push(command)
      return reader.apply(command)
    },
    release: (identity) => {
      commands.push({ kind: 'release', identity })
      reader.apply({ kind: 'release', identity })
    },
  }
  const transport: DocumentSourceEndpoint = { connect: async () => connection }
  return { reader, commands, connection, transport }
}

it('cancels computation waits independently of a shared source ACK and releases a late pin', async () => {
  const buffer = createEditorTextBuffer('stable')
  const delivery = new DocumentDelivery(buffer, 'work-cancel')
  const scope = delivery.createScope()
  const external = endpoint()
  const send = external.connection.send
  let releaseRegister = () => {}
  let registered = () => {}
  const started = new Promise<void>((resolve) => {
    registered = resolve
  })
  external.connection.send = (command, signal) => {
    if (command.kind !== 'register') return send(command, signal)
    const result = external.reader.apply(command)
    registered()
    return new Promise((resolve) => {
      releaseRegister = () => resolve(result)
    })
  }
  const work = new AbortController()
  const first = scope.source.prepareReader(external.transport, delivery.current()!, work.signal)
  await started
  work.abort()
  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  createEditorBufferSession(buffer).applyText('!')
  const latest = delivery.current()!
  const peer = scope.source.prepareReader(external.transport, latest)
  expect(external.commands.some((command) => command.kind === 'reset')).toBe(false)
  releaseRegister()
  const loan = await peer
  expect(loan?.reference.point.revision).toBe(latest.revision.point.revision)
  await loan?.dispose()
  expect(external.reader.inspect().pins).toBe(0)
  scope.dispose()
  expect(external.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  delivery.dispose()
})

it.each(['scope', 'owner'] as const)(
  'retires every endpoint after one %s release callback fails',
  async (boundary) => {
    const delivery = new DocumentDelivery(createEditorTextBuffer('owned'), 'cleanup')
    const scope = delivery.createScope()
    const first = endpoint()
    const peer = endpoint()
    const release = first.connection.release
    const failure = new TypeError('Controlled release failure')
    first.connection.release = (identity) => {
      release(identity)
      throw failure
    }
    const loans = await Promise.all(
      [first, peer].map((source) =>
        scope.source.prepareReader(source.transport, delivery.current()!),
      ),
    )
    for (const loan of loans) await loan?.dispose()
    expect([first.reader.inspect().documents, peer.reader.inspect().documents]).toEqual([1, 1])
    try {
      expect(() => (boundary === 'scope' ? scope.dispose() : delivery.dispose())).toThrow(failure)
      expect([first.reader.inspect().documents, peer.reader.inspect().documents]).toEqual([0, 0])
    } finally {
      first.connection.release = release
      delivery.dispose()
    }
  },
)

it('retires the last source scope while preserving a compatible peer and another endpoint', async () => {
  const buffer = createEditorTextBuffer('left😀\r\nright')
  const delivery = new DocumentDelivery(buffer, 'scope.ts')
  const unsubscribe = buffer.subscribe((event) => delivery.accept(event))
  const first = delivery.createScope()
  const peer = delivery.createScope()
  const other = delivery.createScope()
  const tree = endpoint()
  const shiki = endpoint()
  const head = delivery.current()!
  const initial = await first.source.prepareReader(tree.transport, head)
  const compatible = await peer.source.prepareReader(tree.transport, head)
  const independent = await other.source.prepareReader(shiki.transport, head)
  expect(tree.commands.filter((command) => command.kind === 'register')).toHaveLength(1)
  expect(tree.commands.filter((command) => command.kind === 'reset')).toHaveLength(1)
  const pinned = tree.reader.acquire(compatible!.reference)!
  await initial!.dispose()
  first.dispose()
  expect(pinned.isValid()).toBe(true)
  expect(tree.commands.filter((command) => command.kind === 'release')).toHaveLength(0)
  createEditorBufferSession(buffer).applyText('prefix\n')
  const advanced = await peer.source.prepareReader(tree.transport, delivery.current()!)
  const current = tree.reader.acquire(advanced!.reference)!
  expect(current.text.readRange(0, current.text.length)).toBe(
    buffer.getTextSnapshot().materializeFullText(),
  )
  expect(pinned.text.readRange(0, pinned.text.length)).toBe('left😀\nright')
  current.dispose()
  pinned.dispose()
  await compatible!.dispose()
  await advanced!.dispose()
  peer.dispose()
  expect(tree.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  expect(shiki.reader.inspect().documents).toBe(1)
  await independent!.dispose()
  other.dispose()
  expect(shiki.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  unsubscribe()
  await delivery.dispose()
})

it.each(['register', 'pin'] as const)(
  'settles a stopped %s reply on scope disposal and rejects late admission',
  async (boundary) => {
    const buffer = createEditorTextBuffer('stable')
    const delivery = new DocumentDelivery(buffer, 'stopped.ts')
    const scope = delivery.createScope()
    const transport = endpoint()
    let admitted = () => {}
    const waiting = new Promise<void>((resolve) => {
      admitted = resolve
    })
    let late = () => {}
    const send = transport.connection.send
    transport.connection.send = (command, signal) => {
      if (command.kind !== boundary) return send(command, signal)
      const result = transport.reader.apply(command)
      admitted()
      return new Promise((resolve, reject) => {
        late = () => resolve(result)
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('Scope released', 'AbortError')),
          { once: true },
        )
      })
    }
    const pending = scope.source.prepareReader(transport.transport, delivery.current()!)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await waiting
    scope.dispose()
    await rejected
    expect(transport.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
    late()
    await delivery.dispose()
  },
)

it('settles scope disposal while connection is unresolved', async () => {
  const delivery = new DocumentDelivery(createEditorTextBuffer('stable'), 'connect.ts')
  const scope = delivery.createScope()
  const transport: DocumentSourceEndpoint = { connect: () => new Promise(() => {}) }
  let settled = false
  const pending = scope.source.prepareReader(transport, delivery.current()!)
  void pending.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  scope.dispose()
  await Promise.resolve()
  await Promise.resolve()
  expect(settled).toBe(true)
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await delivery.dispose()
})

it.each(['waiting', 'admitting'] as const)(
  'settles a disposed %s scope independently of a peer source ACK and releases orphan pins',
  async (disposed) => {
    const delivery = new DocumentDelivery(createEditorTextBuffer('stable'), 'peer.ts')
    const admitting = delivery.createScope()
    const waiting = delivery.createScope()
    const external = endpoint()
    let resolveRegister = () => {}
    let admitted = () => {}
    const started = new Promise<void>((resolve) => {
      admitted = resolve
    })
    const send = external.connection.send
    external.connection.send = (command, signal) => {
      if (command.kind !== 'register') return send(command, signal)
      const result = external.reader.apply(command)
      admitted()
      return new Promise((resolve) => {
        resolveRegister = () => resolve(result)
      })
    }
    const head = delivery.current()!
    const first = admitting.source.prepareReader(external.transport, head)
    await started
    const second = waiting.source.prepareReader(external.transport, head)
    const abandoned = disposed === 'waiting' ? second : first
    const survivor = disposed === 'waiting' ? first : second
    let settled = false
    void abandoned.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    if (disposed === 'waiting') waiting.dispose()
    else admitting.dispose()
    await Promise.resolve()
    await Promise.resolve()
    try {
      expect(settled).toBe(true)
      await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
      expect(external.reader.inspect().documents).toBe(1)
      expect(external.commands.filter((command) => command.kind === 'release')).toHaveLength(0)
    } finally {
      resolveRegister()
    }
    const prepared = await survivor
    expect(prepared).not.toBeNull()
    await Promise.resolve()
    await Promise.resolve()
    expect(external.reader.inspect().pins).toBe(1)
    await prepared!.dispose()
    admitting.dispose()
    waiting.dispose()
    expect(external.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
    await delivery.dispose()
  },
)

it.each(['atomic', 'deferred', 'logical-only'] as const)(
  'preserves scoped logical counts for %s projected delivery',
  async (mode) => {
    const buffer = createEditorTextBuffer('abc')
    const delivery = new DocumentDelivery(buffer, 'scoped.ts')
    const unsubscribe = buffer.subscribe((event) => delivery.accept(event))
    const scope = createDocumentLogicalRevisionScope()
    const peerScope = createDocumentLogicalRevisionScope()
    const first = delivery.createScope()
    const peer = delivery.createScope()
    function projected(logicalRevisionScope: typeof scope) {
      const updates: DocumentProjectionUpdate[] = []
      let registration = 0
      const connection = {
        generation: 1,
        nextRegistration: () => ++registration,
        admit: async (update: DocumentProjectionUpdate) => {
          updates.push(update)
          return {
            kind: 'delivered' as const,
            identity: update.identity,
            base: update.base,
            target: update.target,
          }
        },
        release: () => {},
      }
      const endpoint: DocumentProjectionEndpoint = {
        logicalRevisionScope,
        connect: async () => connection,
      }
      return { updates, endpoint }
    }
    const own = projected(scope)
    const other = projected(peerScope)
    const base = delivery.current()!
    await first.source.prepareProjection(own.endpoint, base)
    await peer.source.prepareProjection(other.endpoint, base)
    const count = mode === 'deferred' ? 3 : 4
    const edits =
      mode === 'logical-only' ? [{ from: 1, to: 2, text: 'b' }] : [{ from: 3, to: 3, text: 'X' }]
    const committed = commitPreparedDocumentTransaction(
      { buffer, sourceView: null },
      prepareDocumentTransaction(buffer, edits, count, scope),
      { history: { kind: 'external-barrier', groupId: 'scope' } },
    )
    expect(committed.status).toBe(mode === 'logical-only' ? 'logical-only' : 'committed')
    if (mode === 'deferred')
      createEditorBufferSession(buffer).applyEdits([{ from: 4, to: 4, text: 'Y' }])
    const target = delivery.current()!
    expect(
      first.source.changesBetween(base.revision, target.revision, scope)?.logicalRevisionCount,
    ).toBe(4)
    await first.source.prepareProjection(own.endpoint, target)
    await peer.source.prepareProjection(other.endpoint, target)
    expect(own.updates[1].changes?.logicalRevisionCount).toBe(4)
    expect(other.updates[1].changes?.logicalRevisionCount).toBe(
      mode === 'deferred' ? 2 : mode === 'logical-only' ? 0 : 1,
    )
    expect(own.updates[1].baseRead).toBe(base)
    expect(own.updates[1].read).toBe(target)
    if (mode === 'logical-only') {
      expect(target.text.readRange(0, target.text.length)).toBe(
        base.text.readRange(0, base.text.length),
      )
      expect(target.revision.point.textVersion).toBe(base.revision.point.textVersion)
      expect(target.revision.point.revision).toBe(base.revision.point.revision + 1)
      expect(own.updates[1].changes?.edits).toEqual([])
    }
    first.dispose()
    peer.dispose()
    unsubscribe()
    await delivery.dispose()
  },
)

it.each([false, true])(
  'imports a late captured read without rewinding ACK progress, previously delivered=%s',
  async (delivered) => {
    const buffer = createEditorTextBuffer('old😀\r\nline')
    const delivery = new DocumentDelivery(buffer, 'late.ts')
    const unsubscribe = buffer.subscribe((event) => delivery.accept(event))
    const scope = delivery.createScope()
    const external = endpoint()
    const old = delivery.current()!
    if (delivered) {
      const loan = await scope.source.prepareReader(external.transport, old)
      await loan!.dispose()
    }
    createEditorBufferSession(buffer).applyEdits([{ from: 0, to: 3, text: 'new' }])
    const current = delivery.current()!
    const newest = await scope.source.prepareReader(external.transport, current)
    await newest!.dispose()
    const commands = external.commands.length
    const late = await scope.source.prepareReader(external.transport, old)
    const read = external.reader.acquire(late!.reference)!
    expect(read.text.readRange(0, read.text.length)).toBe('old😀\nline')
    expect(read.point.revision).toBe(old.revision.point.revision)
    expect(external.commands.slice(commands).map((command) => command.kind)).toEqual([
      'pin',
      'importRead',
    ])
    const resumed = await scope.source.prepareReader(external.transport, current)
    const latest = external.reader.acquire(resumed!.reference)!
    expect(latest.text.readRange(0, latest.text.length)).toBe('new😀\nline')
    expect(
      external.commands
        .slice(commands)
        .some((command) => command.kind === 'reset' || command.kind === 'advance'),
    ).toBe(false)
    read.dispose()
    latest.dispose()
    await late!.dispose()
    await resumed!.dispose()
    expect(external.reader.inspect()).toMatchObject({
      reads: 0,
      pins: 0,
      sourceUnits: current.text.length,
    })
    scope.dispose()
    unsubscribe()
    await delivery.dispose()
    expect(external.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  },
)
