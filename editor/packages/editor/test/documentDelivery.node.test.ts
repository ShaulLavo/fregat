import { expect, it } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '../src/documentSession'
import { DocumentDelivery, type DocumentSourceConnection, type DocumentSourceEndpoint } from '../src/editor/documentDelivery'
import { DocumentWorkerReader, type DocumentWorkerSourceCommand } from '../src/document/workerReader'

function endpoint() {
  const reader = new DocumentWorkerReader()
  let registration = 0
  const commands: DocumentWorkerSourceCommand[] = []
  const connection: DocumentSourceConnection = {
    generation: 1,
    nextRegistration: () => ++registration,
    send: async command => { commands.push(command); return reader.apply(command) },
    release: identity => { commands.push({ kind: 'release', identity }); reader.apply({ kind: 'release', identity }) },
  }
  const transport: DocumentSourceEndpoint = { connect: async () => connection }
  return { reader, commands, connection, transport }
}

it('retires the last source scope while preserving a compatible peer and another endpoint', async () => {
  const buffer = createEditorTextBuffer('left😀\r\nright')
  const delivery = new DocumentDelivery(buffer, 'scope.ts')
  const unsubscribe = buffer.subscribe(event => delivery.accept(event))
  const first = delivery.createScope()
  const peer = delivery.createScope()
  const other = delivery.createScope()
  const tree = endpoint()
  const shiki = endpoint()
  const head = delivery.current()!
  const initial = await first.source.prepareReader(tree.transport, head)
  const compatible = await peer.source.prepareReader(tree.transport, head)
  const independent = await other.source.prepareReader(shiki.transport, head)
  expect(tree.commands.filter(command => command.kind === 'register')).toHaveLength(1)
  expect(tree.commands.filter(command => command.kind === 'reset')).toHaveLength(1)
  const pinned = tree.reader.acquire(compatible!.reference)!
  await initial!.dispose()
  first.dispose()
  expect(pinned.isValid()).toBe(true)
  expect(tree.commands.filter(command => command.kind === 'release')).toHaveLength(0)
  createEditorBufferSession(buffer).applyText('prefix\n')
  const advanced = await peer.source.prepareReader(tree.transport, delivery.current()!)
  const current = tree.reader.acquire(advanced!.reference)!
  expect(current.text.readRange(0, current.text.length)).toBe(buffer.getTextSnapshot().materializeFullText())
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

it.each(['register', 'pin'] as const)('settles a stopped %s reply on scope disposal and rejects late admission', async boundary => {
  const buffer = createEditorTextBuffer('stable')
  const delivery = new DocumentDelivery(buffer, 'stopped.ts')
  const scope = delivery.createScope()
  const transport = endpoint()
  let admitted = () => {}
  const waiting = new Promise<void>(resolve => { admitted = resolve })
  let late = () => {}
  const send = transport.connection.send
  transport.connection.send = (command, signal) => {
    if (command.kind !== boundary) return send(command, signal)
    const result = transport.reader.apply(command)
    admitted()
    return new Promise((resolve, reject) => {
      late = () => resolve(result)
      signal.addEventListener('abort', () => reject(new DOMException('Scope released', 'AbortError')), { once: true })
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
})

it('settles scope disposal while connection is unresolved', async () => {
  const delivery = new DocumentDelivery(createEditorTextBuffer('stable'), 'connect.ts')
  const scope = delivery.createScope()
  const transport: DocumentSourceEndpoint = { connect: () => new Promise(() => {}) }
  let settled = false
  const pending = scope.source.prepareReader(transport, delivery.current()!)
  void pending.then(() => { settled = true }, () => { settled = true })
  scope.dispose()
  await Promise.resolve()
  await Promise.resolve()
  expect(settled).toBe(true)
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await delivery.dispose()
})

it.each(['waiting', 'admitting'] as const)('settles a disposed %s scope independently of a peer source ACK and releases orphan pins', async disposed => {
  const delivery = new DocumentDelivery(createEditorTextBuffer('stable'), 'peer.ts')
  const admitting = delivery.createScope()
  const waiting = delivery.createScope()
  const external = endpoint()
  let resolveRegister = () => {}
  let admitted = () => {}
  const started = new Promise<void>(resolve => { admitted = resolve })
  const send = external.connection.send
  external.connection.send = (command, signal) => {
    if (command.kind !== 'register') return send(command, signal)
    const result = external.reader.apply(command)
    admitted()
    return new Promise(resolve => { resolveRegister = () => resolve(result) })
  }
  const head = delivery.current()!
  const first = admitting.source.prepareReader(external.transport, head)
  await started
  const second = waiting.source.prepareReader(external.transport, head)
  const abandoned = disposed === 'waiting' ? second : first
  const survivor = disposed === 'waiting' ? first : second
  let settled = false
  void abandoned.then(() => { settled = true }, () => { settled = true })
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
    expect(external.commands.filter(command => command.kind === 'release')).toHaveLength(0)
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
})
