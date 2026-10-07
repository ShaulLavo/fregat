import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { closeSync, openSync, readSync, ftruncateSync, unlinkSync, writeSync } from 'node:fs'
import { Agent, ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'
import * as v from 'valibot'

export const retentionSocketLimits = {
  client: { records: 8000, bytes: 2621440 },
  serving: { records: 8000, bytes: 2621440 },
} as const
const pageBytes = 4096
const pageHeaderBytes = 16
const frameHeaderBytes = 16
const fixedRecords = 9
const integer = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const tick = v.pipe(v.string(), v.regex(/^\d{1,32}$/))
const clockSchema = v.tuple([integer, tick])
const nullableClock = v.nullable(clockSchema)
const codeSchema = v.nullable(
  v.picklist([
    'ECONNRESET',
    'EPIPE',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ABORT_ERR',
    'ERR_STREAM_PREMATURE_CLOSE',
  ]),
)
const pathSchema = v.pipe(v.string(), v.minLength(1), v.check(isMetadataPath))
function isMetadataPath(value: string) {
  if (!value.startsWith('/') || Buffer.byteLength(value) > 1024) return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127 || character === '?' || character === '#') return false
  }
  return true
}
const identity = {
  id: integer,
  pid: integer,
  thread: integer,
  incarnation: v.pipe(v.string(), v.regex(/^[a-f0-9]{32}$/)),
}
const selectionIdentity = {
  socketId: integer,
  socketIncarnation: identity.incarnation,
  selectedAt: clockSchema,
  destroyedBefore: v.boolean(),
  reusedBefore: v.boolean(),
}
const selectionSchema = v.variant('outcome', [
  v.strictObject({
    ...selectionIdentity,
    completedAt: v.null(),
    outcome: v.null(),
    destroyedAfter: v.null(),
    reusedAfter: v.null(),
  }),
  v.strictObject({
    ...selectionIdentity,
    completedAt: clockSchema,
    outcome: v.picklist(['returned', 'threw']),
    destroyedAfter: v.boolean(),
    reusedAfter: v.boolean(),
  }),
])
const recordSchema = v.variant('kind', [
  v.strictObject({ ...identity, kind: v.literal('scope'), caseId: integer, forwardId: integer }),
  v.strictObject({
    ...identity,
    kind: v.literal('selection'),
    path: pathSchema,
    selection: selectionSchema,
    errored: nullableClock,
    closed: nullableClock,
    aborted: nullableClock,
    code: codeSchema,
  }),
  v.strictObject({
    ...identity,
    kind: v.literal('socket'),
    repeated: integer,
    localFamily: v.picklist([0, 4, 6]),
    remoteFamily: v.picklist([0, 4, 6]),
    localPort: integer,
    remotePort: integer,
    order: integer,
    opened: clockSchema,
    connected: nullableClock,
    ended: nullableClock,
    timedOut: nullableClock,
    timeoutDispatchExitedAt: nullableClock,
    timeoutDispatchDepth: integer,
    destroyInvokedAt: nullableClock,
    destroyContext: v.picklist(['unobserved', 'timeout-dispatch', 'other']),
    destroyCompletion: v.nullable(
      v.strictObject({
        at: clockSchema,
        outcome: v.picklist(['returned', 'threw']),
        destroyed: v.boolean(),
      }),
    ),
    errored: nullableClock,
    closed: nullableClock,
    code: codeSchema,
  }),
  v.strictObject({
    ...identity,
    kind: v.literal('request'),
    repeated: integer,
    socketId: integer,
    order: integer,
    localPort: integer,
    remotePort: integer,
    path: pathSchema,
    caseId: v.nullable(integer),
    forwardId: v.nullable(integer),
    association: v.picklist(['context', 'unavailable', 'serving']),
    started: clockSchema,
    finished: nullableClock,
    errored: nullableClock,
    closed: nullableClock,
    aborted: nullableClock,
    status: v.nullable(integer),
    complete: v.boolean(),
    code: codeSchema,
    selection: v.nullable(selectionSchema),
    attachment: v.strictObject({ destroyed: v.boolean(), reused: v.nullable(v.boolean()) }),
  }),
])
type Record = v.InferOutput<typeof recordSchema>
type Clock = v.InferOutput<typeof clockSchema>
type SocketRecord = Extract<Record, { kind: 'socket' }>
type RequestRecord = Extract<Record, { kind: 'request' }>
type Selection = v.InferOutput<typeof selectionSchema>
type NewRecord = {
  [Kind in Record['kind']]: Omit<Extract<Record, { kind: Kind }>, keyof typeof identity>
}[Record['kind']]
type Side = 'client' | 'serving'
const basenameSchema = v.pipe(
  v.string(),
  v.regex(/^retention-socket-(client|serving)-[1-9]\d{0,15}-[a-f0-9]{32}\.journal$/),
)
export function isRetentionSocketJournalName(value: string) {
  return v.safeParse(basenameSchema, value).success
}
function now(): Clock {
  return [Date.now(), process.hrtime.bigint().toString()]
}
function guard<T>(operation: () => T): T | undefined {
  try {
    return operation()
  } catch {
    return undefined
  }
}
function errorCode(error: unknown) {
  const input = error && typeof error === 'object' && 'code' in error ? error.code : null
  const parsed = v.safeParse(codeSchema, input)
  return parsed.success ? parsed.output : null
}
function loopback(value: string | undefined) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}
function addressFamily(value: string | undefined): 0 | 4 | 6 {
  if (value === '::1') return 6
  return loopback(value) ? 4 : 0
}
function checksum(bytes: Buffer) {
  let value = 2166136261
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0
  return value
}
function writeAll(fd: number, bytes: Buffer, position: number) {
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset, position + offset)
    if (!written) throw { code: 'EIO' }
    offset += written
  }
}
type EmitPhase = 'before' | 'returned' | 'threw'
type EmitObserver = (event: string | symbol, args: readonly unknown[], phase: EmitPhase) => void
type CallOutcome = 'returned' | 'threw'
type MethodCompletion = (outcome: CallOutcome) => void
type MethodObserver<Args extends readonly unknown[]> = (args: Args) => MethodCompletion | undefined
type DestroyObserver = MethodObserver<readonly unknown[]>
type ReuseObserver = MethodObserver<Readonly<Parameters<Agent['reuseSocket']>>>
type MethodHook<Observer> = {
  method: unknown
  descriptor: PropertyDescriptor | undefined
  observers: Observer[]
}
type EmitHook = MethodHook<EmitObserver>
const provenanceEmitHooks = new Map<EventEmitter, EmitHook>()
const provenanceDestroyHooks = new Map<EventEmitter, MethodHook<DestroyObserver>>()
const provenanceReuseHooks = new Map<EventEmitter, MethodHook<ReuseObserver>>()

function beginMethodObservation<Args extends readonly unknown[]>(
  observers: readonly MethodObserver<Args>[],
  subject: EventEmitter,
  args: Args,
) {
  const completions: MethodCompletion[] = []
  for (let index = observers.length - 1; index >= 0; index--) {
    const observer = observers[index]
    if (!observer) continue
    const completion = guard(() => observer.call(subject, args))
    if (completion) completions.push(completion)
  }
  return completions
}

function completeMethodObservation(completions: readonly MethodCompletion[], outcome: CallOutcome) {
  for (const complete of completions) guard(() => complete(outcome))
}

function dispatchEmitObservers(
  observers: readonly EmitObserver[],
  subject: EventEmitter,
  event: string | symbol,
  args: readonly unknown[],
  phase: EmitPhase,
) {
  for (let index = observers.length - 1; index >= 0; index--) {
    const observer = observers[index]
    if (observer) guard(() => Reflect.apply(observer, subject, [event, args, phase]))
  }
}

function releaseMethodObserver<Observer>(
  target: EventEmitter,
  key: 'emit' | 'destroy' | 'reuseSocket',
  registry: Map<EventEmitter, MethodHook<Observer>>,
  hook: MethodHook<Observer>,
  observer: Observer,
) {
  let active = true
  return () => {
    if (!active) return
    active = false
    const index = hook.observers.indexOf(observer)
    if (index >= 0) hook.observers.splice(index, 1)
    if (hook.observers.length) return
    registry.delete(target)
    if (Reflect.get(target, key) !== hook.method) return
    if (hook.descriptor) Object.defineProperty(target, key, hook.descriptor)
    if (!hook.descriptor) Reflect.deleteProperty(target, key)
  }
}

function installEmitHook(target: EventEmitter): EmitHook {
  const original = target.emit
  const descriptor = Object.getOwnPropertyDescriptor(target, 'emit')
  const observers: EmitObserver[] = []
  const emit = function (this: EventEmitter, event: string | symbol, ...args: unknown[]): boolean {
    dispatchEmitObservers(observers, this, event, args, 'before')
    let returned = false
    try {
      const result = Reflect.apply(original, this, [event, ...args])
      returned = true
      return result
    } finally {
      dispatchEmitObservers(observers, this, event, args, returned ? 'returned' : 'threw')
    }
  }
  const hook = { method: emit, descriptor, observers }
  target.emit = emit
  provenanceEmitHooks.set(target, hook)
  return hook
}

function wrapEmit<T extends EventEmitter>(
  target: T,
  observe: (subject: T, event: string | symbol, args: readonly unknown[]) => void,
  settled?: (
    subject: T,
    event: string | symbol,
    args: readonly unknown[],
    phase: Exclude<EmitPhase, 'before'>,
  ) => void,
) {
  const hook = provenanceEmitHooks.get(target) ?? installEmitHook(target)
  const observer = function (
    this: T,
    event: string | symbol,
    args: readonly unknown[],
    phase: EmitPhase,
  ) {
    if (phase === 'before') {
      observe(this, event, args)
      return
    }
    settled?.(this, event, args, phase)
  }
  hook.observers.push(observer)
  return releaseMethodObserver(target, 'emit', provenanceEmitHooks, hook, observer)
}

function installDestroyHook(target: Socket): MethodHook<DestroyObserver> {
  const original = target.destroy
  const descriptor = Object.getOwnPropertyDescriptor(target, 'destroy')
  const observers: DestroyObserver[] = []
  const destroy: Socket['destroy'] = function (this: Socket, ...args) {
    const completions = beginMethodObservation(observers, this, args)
    let outcome: CallOutcome = 'threw'
    try {
      const result = Reflect.apply(original, this, args)
      outcome = 'returned'
      return result
    } finally {
      completeMethodObservation(completions, outcome)
    }
  }
  const hook = { method: destroy, descriptor, observers }
  target.destroy = destroy
  provenanceDestroyHooks.set(target, hook)
  return hook
}

function wrapDestroy(
  target: Socket,
  observe: (subject: Socket, args: readonly unknown[]) => MethodCompletion | undefined,
) {
  const hook = provenanceDestroyHooks.get(target) ?? installDestroyHook(target)
  const observer = function (this: Socket, args: readonly unknown[]) {
    return observe(this, args)
  }
  hook.observers.push(observer)
  return releaseMethodObserver(target, 'destroy', provenanceDestroyHooks, hook, observer)
}

function installReuseHook(target: Agent): MethodHook<ReuseObserver> {
  const original = target.reuseSocket
  const descriptor = Object.getOwnPropertyDescriptor(target, 'reuseSocket')
  const observers: ReuseObserver[] = []
  const reuseSocket: Agent['reuseSocket'] = function (this: Agent, ...args) {
    const completions = beginMethodObservation(observers, this, args)
    let outcome: CallOutcome = 'threw'
    try {
      const result = Reflect.apply(original, this, args)
      outcome = 'returned'
      return result
    } finally {
      completeMethodObservation(completions, outcome)
    }
  }
  const hook = { method: reuseSocket, descriptor, observers }
  target.reuseSocket = reuseSocket
  provenanceReuseHooks.set(target, hook)
  return hook
}

function wrapReuse(
  target: Agent,
  observe: (args: Readonly<Parameters<Agent['reuseSocket']>>) => MethodCompletion | undefined,
) {
  const hook = provenanceReuseHooks.get(target) ?? installReuseHook(target)
  hook.observers.push(observe)
  return releaseMethodObserver(target, 'reuseSocket', provenanceReuseHooks, hook, observe)
}

function createJournal(side: Side) {
  const limits = retentionSocketLimits[side]
  const incarnation = randomUUID().replaceAll('-', '')
  const basename = `retention-socket-${side}-${process.pid}-${incarnation}.journal`
  const path = join(tmpdir(), basename)
  const references = new Map<object, number>()
  const maximumReferences = Math.floor(limits.records / 4)
  const indexBuffer = new ArrayBuffer(limits.records * 16)
  const offsets = new Uint16Array(indexBuffer, 0, limits.records),
    capacities = new Uint16Array(indexBuffer, limits.records * 2, limits.records),
    pages = new Uint16Array(indexBuffer, limits.records * 4, limits.records),
    pins = new Uint16Array(indexBuffer, limits.records * 6, limits.records),
    ids = new Uint32Array(indexBuffer, limits.records * 8, limits.records),
    versions = new Uint32Array(indexBuffer, limits.records * 12, limits.records)
  const indexBytes =
    offsets.byteLength +
    capacities.byteLength +
    pages.byteLength +
    pins.byteLength +
    ids.byteLength +
    versions.byteLength
  const reservedBytes = indexBytes + maximumReferences * 32 + pageBytes * 7
  const pageCount = Math.floor((limits.bytes - reservedBytes) / pageBytes)
  const reservedTotal = reservedBytes + pageCount * pageBytes
  const input = Buffer.alloc(pageBytes),
    output = Buffer.alloc(pageBytes)
  let fd: number | null = null,
    cursorPage = 0,
    cursorOffset = pageHeaderBytes,
    count = 0,
    sequence = 0,
    revision = 0
  let evicted = 0,
    refused = 0,
    referenceRefused = 0,
    partial = 0,
    unavailable = false,
    closed = false
  let evictedSocketThrough = '0',
    evictedRequestThrough = '0'
  const coverage = () => ({
    clockDomain: process.versions.bun ? 'bun' : 'node',
    side,
    pid: process.pid,
    thread: threadId,
    incarnation,
    basename,
    sequence,
    revision,
    evicted,
    refused,
    referenceRefused,
    partial,
    unavailable,
    retainedRecords: count + references.size + fixedRecords,
    retainedBytes: reservedTotal,
    pageCount,
    pageBytes,
    evictedSocketThrough,
    evictedRequestThrough,
  })
  const publish = () => {
    if (fd === null) return
    const body = Buffer.from(JSON.stringify({ version: 1, ...coverage() }))
    output.fill(0)
    output.writeUInt32LE(body.length, 0)
    body.copy(output, 4)
    writeAll(fd, output, 0)
  }
  const safePublish = () => {
    if (!guard(publish)) return
  }
  try {
    fd = openSync(path, 'wx+')
    ftruncateSync(fd, pageBytes * (pageCount + 1))
    publish()
  } catch {
    unavailable = true
  }
  const position = (page: number, offset: number) => pageBytes * (page + 1) + offset
  const incompleteRead = () => {
    partial++
    safePublish()
    return null
  }
  const readSlot = (slot: number): Record | null => {
    if (fd === null || !ids[slot]) return null
    const size = readSync(
      fd,
      input,
      0,
      frameHeaderBytes + capacities[slot],
      position(pages[slot], offsets[slot]),
    )
    if (size < frameHeaderBytes) return incompleteRead()
    if (input.readUInt32LE(4) !== ids[slot]) return null
    const length = input.readUInt16LE(0),
      version = input.readUInt32LE(8)
    if (version % 2 || length > capacities[slot]) return null
    if (size < frameHeaderBytes + length) return incompleteRead()
    const body = input.subarray(frameHeaderBytes, frameHeaderBytes + length)
    if (checksum(body) !== input.readUInt32LE(12)) return null
    const parsed = v.safeParse(recordSchema, JSON.parse(body.toString('utf8')))
    return parsed.success ? parsed.output : null
  }
  const freeSlot = (slot: number, loss: boolean) => {
    if (!ids[slot] || fd === null) return
    const record = loss ? guard(() => readSlot(slot)) : null
    if (record?.kind === 'socket')
      evictedSocketThrough =
        BigInt(record.closed?.[1] ?? record.opened[1]) > BigInt(evictedSocketThrough)
          ? (record.closed?.[1] ?? record.opened[1])
          : evictedSocketThrough
    if (record?.kind === 'request')
      evictedRequestThrough =
        BigInt(record.closed?.[1] ?? record.started[1]) > BigInt(evictedRequestThrough)
          ? (record.closed?.[1] ?? record.started[1])
          : evictedRequestThrough
    if (loss) evicted++
    output.fill(0, 0, 4)
    output.writeUInt16LE(capacities[slot], 2)
    writeAll(fd, output.subarray(0, 4), position(pages[slot], offsets[slot]))
    ids[slot] = 0
    count--
  }
  const recycle = (page: number) => {
    for (let slot = 0; slot < ids.length; slot++)
      if (ids[slot] && pages[slot] === page && pins[slot]) return false
    for (let slot = 0; slot < ids.length; slot++)
      if (ids[slot] && pages[slot] === page) freeSlot(slot, true)
    output.fill(0)
    if (fd !== null) writeAll(fd, output, position(page, 0))
    cursorPage = page
    cursorOffset = pageHeaderBytes
    return true
  }
  const nextPage = () => {
    for (let step = 1; step <= pageCount; step++)
      if (recycle((cursorPage + step) % pageCount)) return true
    return false
  }
  const store = (slot: number, record: Record) => {
    if (fd === null) return false
    const parsed = v.safeParse(recordSchema, record)
    if (!parsed.success) {
      refused++
      return false
    }
    const body = Buffer.from(JSON.stringify(parsed.output))
    if (body.length > capacities[slot] || body.length > pageBytes) {
      refused++
      return false
    }
    const positionValue = position(pages[slot], offsets[slot])
    const version = versions[slot] + 2
    output.fill(0, 0, frameHeaderBytes)
    output.writeUInt16LE(capacities[slot], 2)
    output.writeUInt32LE(ids[slot], 4)
    output.writeUInt32LE(version - 1, 8)
    writeAll(fd, output.subarray(0, frameHeaderBytes), positionValue)
    writeAll(fd, body, positionValue + frameHeaderBytes)
    output.writeUInt16LE(body.length, 0)
    output.writeUInt32LE(version, 8)
    output.writeUInt32LE(checksum(body), 12)
    writeAll(fd, output.subarray(0, frameHeaderBytes), positionValue)
    versions[slot] = version
    revision++
    publish()
    return true
  }
  const reserve = (capacity: number) => {
    let attempts = 0
    while (
      count + references.size + fixedRecords >= limits.records ||
      cursorOffset + frameHeaderBytes + capacity > pageBytes
    ) {
      if (attempts++ >= pageCount || !nextPage()) return false
    }
    return true
  }
  const create = (record: NewRecord) => {
    if (closed || unavailable || fd === null) return null
    try {
      if (sequence >= 0xffffffff) {
        unavailable = true
        return null
      }
      const value = { ...record, id: sequence + 1, pid: process.pid, thread: threadId, incarnation }
      const parsed = v.safeParse(recordSchema, value)
      if (!parsed.success) {
        refused++
        publish()
        return null
      }
      const growth = { socket: 448, request: 320, selection: 256, scope: 128 }
      const capacity = Buffer.byteLength(JSON.stringify(parsed.output)) + growth[record.kind]
      if (capacity + frameHeaderBytes > pageBytes - pageHeaderBytes) {
        refused++
        publish()
        return null
      }
      if (!reserve(capacity)) {
        refused++
        publish()
        return null
      }
      const slot = ids.findIndex((id) => !id)
      if (slot < 0) {
        refused++
        publish()
        return null
      }
      sequence++
      ids[slot] = sequence
      pages[slot] = cursorPage
      offsets[slot] = cursorOffset
      capacities[slot] = capacity
      pins[slot] = 0
      versions[slot] = 0
      count++
      cursorOffset += frameHeaderBytes + capacity
      if (!store(slot, parsed.output)) {
        freeSlot(slot, false)
        return null
      }
      return slot
    } catch {
      unavailable = true
      safePublish()
      return null
    }
  }
  const lookup = (subject: object) => {
    const slot = references.get(subject)
    return slot === undefined ? null : (guard(() => readSlot(slot)) ?? null)
  }
  const bind = (subject: object, slot: number) => {
    if (
      references.has(subject) ||
      references.size >= maximumReferences ||
      count + references.size + fixedRecords >= limits.records
    ) {
      referenceRefused++
      safePublish()
      return false
    }
    references.set(subject, slot)
    pins[slot]++
    return true
  }
  const release = (subject: object, discard = false) => {
    const slot = references.get(subject)
    if (slot === undefined) return
    references.delete(subject)
    pins[slot]--
    if (discard) guard(() => freeSlot(slot, false))
  }
  const update = (subject: object, edit: (record: Record) => Record) => {
    const slot = references.get(subject)
    if (slot === undefined || unavailable) return null
    try {
      const previousPartial = partial
      const record = readSlot(slot)
      if (!record && partial === previousPartial) partial++
      if (!record) return null
      const edited = edit(record)
      return store(slot, edited) ? edited : null
    } catch {
      unavailable = true
      safePublish()
      return null
    }
  }
  return {
    basename,
    coverage,
    create,
    lookup,
    bind,
    release,
    update,
    slot: (slot: number) => guard(() => readSlot(slot)) ?? null,
    identity: (id: number) => {
      const slot = ids.findIndex((value) => value === id && value !== 0)
      return slot < 0 ? null : (guard(() => readSlot(slot)) ?? null)
    },
    close() {
      closed = true
      guard(publish)
      references.clear()
      const currentFd = fd
      if (currentFd !== null) guard(() => closeSync(currentFd))
      fd = null
    },
    remove() {
      guard(() => unlinkSync(path))
    },
  }
}

export function createRetentionSocketProvenance(options: {
  side: Side
  entryPort: number
  normalizePath: (path: string) => string | null
  server?: EventEmitter
}) {
  const journal = createJournal(options.side)
  const context = new AsyncLocalStorage<number>()
  const restores: (() => void)[] = []
  let stopped = false
  const getSocket = (socket: Socket) => {
    const value = journal.lookup(socket)
    return value?.kind === 'socket' ? value : null
  }
  const openSocket = (socket: Socket) => {
    const known = getSocket(socket)
    if (known) return known
    const localPort = socket.localPort ?? 0,
      remotePort = socket.remotePort ?? (options.side === 'client' ? options.entryPort : 0)
    if (options.side === 'serving' && localPort !== options.entryPort) return null
    if (options.side === 'client' && remotePort !== options.entryPort) return null
    if (!socket.connecting && (!loopback(socket.localAddress) || !loopback(socket.remoteAddress)))
      return null
    const slot = journal.create({
      kind: 'socket',
      repeated: 0,
      localFamily: addressFamily(socket.localAddress),
      remoteFamily: addressFamily(socket.remoteAddress),
      localPort,
      remotePort,
      order: 0,
      opened: now(),
      connected: null,
      ended: null,
      timedOut: null,
      timeoutDispatchExitedAt: null,
      timeoutDispatchDepth: 0,
      destroyInvokedAt: null,
      destroyContext: 'unobserved',
      destroyCompletion: null,
      errored: null,
      closed: null,
      code: null,
    })
    if (slot === null || !journal.bind(socket, slot)) return null
    const value = journal.slot(slot)
    return value?.kind === 'socket' ? value : null
  }
  const socketEvent = (socket: Socket, event: string | symbol, args: readonly unknown[]) => {
    if (stopped || !['connect', 'end', 'timeout', 'error', 'close'].includes(String(event))) return
    if (event === 'connect' && options.side === 'client' && socket.remotePort === options.entryPort)
      openSocket(socket)
    if (!getSocket(socket)) return
    journal.update(socket, (value) => {
      if (value.kind !== 'socket') return value
      const base = {
        ...value,
        localFamily: addressFamily(socket.localAddress) || value.localFamily,
        remoteFamily: addressFamily(socket.remoteAddress) || value.remoteFamily,
        localPort: socket.localPort ?? value.localPort,
        remotePort: socket.remotePort ?? value.remotePort,
      }
      if (event === 'connect')
        return { ...base, repeated: base.repeated + (base.connected ? 1 : 0), connected: now() }
      if (event === 'end')
        return { ...base, repeated: base.repeated + (base.ended ? 1 : 0), ended: now() }
      if (event === 'timeout')
        return {
          ...base,
          repeated: base.repeated + (base.timedOut ? 1 : 0),
          timedOut: now(),
          timeoutDispatchExitedAt: null,
          timeoutDispatchDepth: base.timeoutDispatchDepth + 1,
        }
      if (event === 'error')
        return {
          ...base,
          repeated: base.repeated + (base.errored ? 1 : 0),
          errored: now(),
          code: errorCode(args[0]),
        }
      return { ...base, repeated: base.repeated + (base.closed ? 1 : 0), closed: now() }
    })
    if (event === 'close') journal.release(socket)
  }
  const socketDispatchSettled = (socket: Socket, event: string | symbol) => {
    if (stopped || event !== 'timeout') return
    journal.update(socket, (value) => {
      if (value.kind !== 'socket' || !value.timeoutDispatchDepth) return value
      return {
        ...value,
        timeoutDispatchDepth: value.timeoutDispatchDepth - 1,
        timeoutDispatchExitedAt: now(),
      }
    })
  }
  const socketDestroy = (socket: Socket) => {
    if (stopped) return
    const first = getSocket(socket)
    if (!first || first.destroyInvokedAt) return
    const coverage = journal.coverage()
    const incomplete =
      coverage.partial || coverage.refused || coverage.referenceRefused || coverage.unavailable
    const captured = journal.update(socket, (value) => {
      if (value.kind !== 'socket') return value
      let destroyContext: SocketRecord['destroyContext'] = 'unobserved'
      if (!incomplete) destroyContext = value.timeoutDispatchDepth ? 'timeout-dispatch' : 'other'
      return {
        ...value,
        destroyInvokedAt: now(),
        destroyContext,
      }
    })
    if (captured?.kind !== 'socket' || !captured.destroyInvokedAt) return
    const invocation = captured.destroyInvokedAt[1]
    return (outcome: CallOutcome) => {
      journal.update(socket, (value) => {
        if (
          value.kind !== 'socket' ||
          value.destroyInvokedAt?.[1] !== invocation ||
          value.destroyCompletion
        )
          return value
        return { ...value, destroyCompletion: { at: now(), outcome, destroyed: socket.destroyed } }
      })
    }
  }
  const observeReuse = ([socket, request]: Readonly<Parameters<Agent['reuseSocket']>>) => {
    if (stopped || !(socket instanceof Socket) || !(request instanceof ClientRequest)) return
    const connection = getSocket(socket)
    const path = options.normalizePath(request.path)
    if (!connection || path === null || journal.lookup(request)) return
    const host = request.getHeader('host')
    if (
      host !== `127.0.0.1:${options.entryPort}` &&
      host !== `localhost:${options.entryPort}` &&
      host !== `[::1]:${options.entryPort}`
    )
      return
    const selection: Selection = {
      socketId: connection.id,
      socketIncarnation: connection.incarnation,
      selectedAt: now(),
      destroyedBefore: socket.destroyed,
      reusedBefore: request.reusedSocket,
      completedAt: null,
      outcome: null,
      destroyedAfter: null,
      reusedAfter: null,
    }
    const slot = journal.create({
      kind: 'selection',
      path,
      selection,
      errored: null,
      closed: null,
      aborted: null,
      code: null,
    })
    if (slot === null || !journal.bind(request, slot)) return
    return (outcome: CallOutcome) => {
      journal.update(request, (value) => {
        if (value.kind !== 'selection' && value.kind !== 'request') return value
        if (value.selection?.selectedAt[1] !== selection.selectedAt[1]) return value
        return {
          ...value,
          selection: {
            ...value.selection,
            completedAt: now(),
            outcome,
            destroyedAfter: socket.destroyed,
            reusedAfter: request.reusedSocket,
          },
        }
      })
      if (outcome === 'threw') journal.release(request)
    }
  }
  const attachRequest = (subject: object, socket: Socket, path: string) => {
    let connection = getSocket(socket)
    if (!connection && socket.connecting) connection = openSocket(socket)
    const normalized = options.normalizePath(path)
    if (!connection || normalized === null) return
    const current = journal.update(socket, (value) =>
      value.kind === 'socket' ? { ...value, order: value.order + 1 } : value,
    )
    if (current?.kind !== 'socket') return
    const scopeId = context.getStore()
    const scope = scopeId === undefined ? null : journal.identity(scopeId)
    let association: RequestRecord['association'] =
      options.side === 'serving' ? 'serving' : 'unavailable'
    if (options.side === 'client' && scope?.kind === 'scope') association = 'context'
    const pending = journal.lookup(subject)
    const selection = pending?.kind === 'selection' ? pending.selection : null
    if (pending?.kind === 'selection') journal.release(subject, true)
    const slot = journal.create({
      kind: 'request',
      repeated: 0,
      socketId: current.id,
      order: current.order,
      localPort: socket.localPort ?? current.localPort,
      remotePort: socket.remotePort ?? current.remotePort,
      path: normalized,
      caseId: scope?.kind === 'scope' ? scope.caseId : null,
      forwardId: scope?.kind === 'scope' ? scope.forwardId : null,
      association,
      started: now(),
      finished: null,
      errored: null,
      closed: null,
      aborted: null,
      status: null,
      complete: false,
      code: null,
      selection,
      attachment: {
        destroyed: socket.destroyed,
        reused: subject instanceof ClientRequest ? subject.reusedSocket : null,
      },
    })
    if (slot !== null) journal.bind(subject, slot)
  }
  const requestEvent = (
    subject: object,
    event: string | symbol,
    args: readonly unknown[],
    response?: ServerResponse,
  ) => {
    if (!['finish', 'error', 'close', 'aborted'].includes(String(event))) return
    journal.update(subject, (value) => {
      if (value.kind === 'selection') {
        if (event === 'error') return { ...value, errored: now(), code: errorCode(args[0]) }
        if (event === 'aborted') return { ...value, aborted: now() }
        if (event === 'close') return { ...value, closed: now() }
        return value
      }
      if (value.kind !== 'request') return value
      if (event === 'finish')
        return {
          ...value,
          repeated: value.repeated + (value.finished ? 1 : 0),
          finished: now(),
          status: response?.statusCode ?? value.status,
          complete: response?.writableFinished ?? value.complete,
        }
      if (event === 'error')
        return {
          ...value,
          repeated: value.repeated + (value.errored ? 1 : 0),
          errored: now(),
          code: errorCode(args[0]),
        }
      if (event === 'aborted')
        return { ...value, repeated: value.repeated + (value.aborted ? 1 : 0), aborted: now() }
      return {
        ...value,
        repeated: value.repeated + (value.closed ? 1 : 0),
        closed: now(),
        complete: response?.writableFinished ?? value.complete,
      }
    })
    if (event === 'close') journal.release(subject)
  }
  restores.push(wrapEmit(Socket.prototype, socketEvent, socketDispatchSettled))
  restores.push(wrapDestroy(Socket.prototype, socketDestroy))
  if (options.side === 'client') restores.push(wrapReuse(Agent.prototype, observeReuse))
  if (options.side === 'client')
    restores.push(
      wrapEmit(ClientRequest.prototype, (request, event, args) => {
        if (stopped) return
        if (event === 'socket' && args[0] instanceof Socket) {
          const host = request.getHeader('host')
          if (
            host === `127.0.0.1:${options.entryPort}` ||
            host === `localhost:${options.entryPort}` ||
            host === `[::1]:${options.entryPort}`
          )
            attachRequest(request, args[0], request.path)
          return
        }
        requestEvent(request, event, args)
      }),
    )
  if (options.side === 'serving' && options.server) {
    restores.push(
      wrapEmit(options.server, (_server, event, args) => {
        if (stopped) return
        if (event === 'connection' && args[0] instanceof Socket) openSocket(args[0])
        if ((event === 'request' || event === 'upgrade') && args[0] instanceof IncomingMessage)
          attachRequest(args[0], args[0].socket, args[0].url ?? '')
      }),
    )
    restores.push(
      wrapEmit(ServerResponse.prototype, (response, event, args) => {
        if (!stopped) requestEvent(response.req, event, args, response)
      }),
    )
    restores.push(
      wrapEmit(IncomingMessage.prototype, (request, event, args) => {
        if (!stopped && (event === 'aborted' || event === 'error'))
          requestEvent(request, event, args)
      }),
    )
  }
  return {
    basename: journal.basename,
    inspect: journal.coverage,
    runForward<T>(caseId: number, observation: { requestId: number }, operation: () => T): T {
      const slot = journal.create({ kind: 'scope', caseId, forwardId: observation.requestId })
      if (slot === null || !journal.bind(observation, slot)) return context.run(-1, operation)
      const scope = journal.slot(slot)
      return context.run(scope?.kind === 'scope' ? scope.id : -1, operation)
    },
    endForward(observation: object) {
      journal.release(observation, true)
    },
    close() {
      stopped = true
      for (const restore of restores.toReversed()) restore()
      restores.length = 0
      journal.close()
    },
    remove: journal.remove,
  }
}

const coverageSchema = v.strictObject({
  clockDomain: v.picklist(['node', 'bun']),
  version: v.literal(1),
  side: v.picklist(['client', 'serving']),
  pid: integer,
  thread: integer,
  incarnation: identity.incarnation,
  basename: basenameSchema,
  sequence: integer,
  revision: integer,
  evicted: integer,
  refused: integer,
  referenceRefused: integer,
  partial: integer,
  unavailable: v.boolean(),
  retainedRecords: integer,
  retainedBytes: integer,
  pageCount: integer,
  pageBytes: v.literal(4096),
  evictedSocketThrough: tick,
  evictedRequestThrough: tick,
})
type Coverage = v.InferOutput<typeof coverageSchema>
export type RetentionSocketSnapshot = {
  status: 'written' | 'unavailable'
  basename: string
  source: string
  coverage: Coverage | null
  copied: number
  partial: number
  raced: boolean
  code: string | null
}

function readCoverage(fd: number, buffer: Buffer): Coverage | null {
  const read = readSync(fd, buffer, 0, pageBytes, 0)
  if (read !== pageBytes) return null
  const length = buffer.readUInt32LE(0)
  if (!length || length > pageBytes - 4) return null
  const parsed = v.safeParse(
    coverageSchema,
    JSON.parse(buffer.subarray(4, length + 4).toString('utf8')),
  )
  if (!parsed.success) return null
  if (
    parsed.output.basename !==
    `retention-socket-${parsed.output.side}-${parsed.output.pid}-${parsed.output.incarnation}.journal`
  )
    return null
  const limits = retentionSocketLimits[parsed.output.side]
  return parsed.output.retainedRecords <= limits.records &&
    parsed.output.retainedBytes <= limits.bytes &&
    parsed.output.pageCount * pageBytes < limits.bytes
    ? parsed.output
    : null
}

function copySnapshotPage(
  source: number,
  page: number,
  buffer: Buffer,
  header: Buffer,
  coverage: Coverage,
  write: (record: Record) => void,
) {
  if (readSync(source, buffer, 0, pageBytes, pageBytes * (page + 1)) !== pageBytes)
    return { copied: 0, partial: 1 }
  let offset = pageHeaderBytes,
    copied = 0,
    partial = 0
  while (offset + frameHeaderBytes <= pageBytes) {
    const length = buffer.readUInt16LE(offset),
      capacity = buffer.readUInt16LE(offset + 2)
    if (!capacity) break
    if (capacity + frameHeaderBytes + offset > pageBytes || length > capacity) {
      partial++
      break
    }
    const end = offset + frameHeaderBytes + capacity
    if (!length) {
      offset = end
      continue
    }
    const body = buffer.subarray(offset + frameHeaderBytes, offset + frameHeaderBytes + length)
    readSync(source, header, 0, frameHeaderBytes, pageBytes * (page + 1) + offset)
    const intact =
      header.equals(buffer.subarray(offset, offset + frameHeaderBytes)) &&
      header.readUInt32LE(8) % 2 === 0 &&
      checksum(body) === header.readUInt32LE(12)
    const parsed = intact
      ? guard(() => v.safeParse(recordSchema, JSON.parse(body.toString('utf8'))))
      : undefined
    if (
      !parsed?.success ||
      parsed.output.pid !== coverage.pid ||
      parsed.output.thread !== coverage.thread ||
      parsed.output.incarnation !== coverage.incarnation ||
      parsed.output.id !== header.readUInt32LE(4)
    ) {
      partial++
      offset = end
      continue
    }
    if (parsed.output.kind !== 'scope') {
      write(parsed.output)
      copied++
    }
    offset = end
  }
  return { copied, partial }
}

export function snapshotRetentionSocketJournal(
  name: string,
  output: string,
  stage: 'frozen' | 'final',
): RetentionSocketSnapshot {
  const empty: RetentionSocketSnapshot = {
    status: 'unavailable',
    basename: '',
    source: name,
    coverage: null,
    copied: 0,
    partial: 0,
    raced: false,
    code: null,
  }
  if (!isRetentionSocketJournalName(name)) return empty
  let source: number | null = null,
    target: number | null = null
  try {
    source = openSync(join(tmpdir(), name), 'r')
    const buffer = Buffer.alloc(pageBytes)
    const coverage = readCoverage(source, buffer)
    if (!coverage || coverage.basename !== name) return empty
    const basename = `socket-provenance-${coverage.side}-${stage}.jsonl`
    target = openSync(join(output, basename), 'w')
    const targetFd = target
    let positionValue = 0,
      copied = 0,
      partial = 0
    const write = (value: unknown) => {
      const encoded = Buffer.from(JSON.stringify(value) + '\n')
      if (encoded.length > pageBytes) throw { code: 'EIO' }
      writeAll(targetFd, encoded, positionValue)
      positionValue += encoded.length
    }
    write({ kind: 'coverage-start', ...coverage })
    const header = Buffer.alloc(frameHeaderBytes)
    for (let page = 0; page < coverage.pageCount; page++) {
      const result = copySnapshotPage(source, page, buffer, header, coverage, write)
      copied += result.copied
      partial += result.partial
    }
    const last = readCoverage(source, buffer)
    const raced = !last || coverage.revision !== last.revision
    write({ kind: 'coverage-end', copied, partial, raced })
    return {
      status: 'written',
      basename,
      source: name,
      coverage,
      copied,
      partial,
      raced,
      code: null,
    }
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : null
    return { ...empty, code }
  } finally {
    const sourceFd = source,
      targetFd = target
    if (sourceFd !== null) guard(() => closeSync(sourceFd))
    if (targetFd !== null) guard(() => closeSync(targetFd))
  }
}

function* snapshotRecords(path: string): Generator<Record> {
  const fd = openSync(path, 'r')
  try {
    yield* readSnapshotRecords(fd)
  } finally {
    closeSync(fd)
  }
}
function* readSnapshotRecords(fd: number): Generator<Record> {
  const buffer = Buffer.alloc(pageBytes),
    line = Buffer.alloc(pageBytes),
    cursor = { size: 0 }
  let read = 0
  while ((read = readSync(fd, buffer)) > 0)
    yield* snapshotChunkRecords(buffer.subarray(0, read), line, cursor)
  if (cursor.size) throw { code: 'EIO' }
}
function* snapshotChunkRecords(
  chunk: Buffer,
  line: Buffer,
  cursor: { size: number },
): Generator<Record> {
  for (const byte of chunk) {
    if (byte !== 10 && cursor.size === line.length) throw { code: 'EIO' }
    if (byte !== 10) {
      line[cursor.size++] = byte
      continue
    }
    const parsed = v.safeParse(
      recordSchema,
      JSON.parse(line.subarray(0, cursor.size).toString('utf8')),
    )
    cursor.size = 0
    if (parsed.success) yield parsed.output
  }
}

export type RetentionSocketAssociation =
  | {
      status: 'exact'
      client: RequestRecord
      clientSocket: SocketRecord
      serving: RequestRecord
      servingSocket: SocketRecord
    }
  | { status: 'unavailable' | 'ambiguous'; why: string }

export function associateRetentionSocketFailure(
  output: string,
  client: RetentionSocketSnapshot,
  serving: RetentionSocketSnapshot,
  caseId: number,
  forwardId: number,
): RetentionSocketAssociation {
  if (
    client.status !== 'written' ||
    serving.status !== 'written' ||
    !client.coverage ||
    !serving.coverage
  )
    return { status: 'unavailable', why: 'journal-unavailable' }
  if (client.coverage.clockDomain !== serving.coverage.clockDomain)
    return { status: 'unavailable', why: 'clock-domain-unavailable' }
  if (
    client.partial ||
    serving.partial ||
    client.coverage.unavailable ||
    serving.coverage.unavailable ||
    client.coverage.refused ||
    serving.coverage.refused ||
    client.coverage.referenceRefused ||
    serving.coverage.referenceRefused
  )
    return { status: 'unavailable', why: 'journal-incomplete' }
  try {
    return associateSnapshots(output, client, serving, caseId, forwardId)
  } catch {
    return { status: 'unavailable', why: 'snapshot-unreadable' }
  }
}

function associateSnapshots(
  output: string,
  client: RetentionSocketSnapshot,
  serving: RetentionSocketSnapshot,
  caseId: number,
  forwardId: number,
): RetentionSocketAssociation {
  if (!serving.coverage) return { status: 'unavailable', why: 'journal-unavailable' }
  let request: RequestRecord | null = null,
    requestCount = 0
  for (const row of snapshotRecords(join(output, client.basename))) {
    if (
      row.kind !== 'request' ||
      row.association !== 'context' ||
      row.caseId !== caseId ||
      row.forwardId !== forwardId ||
      !row.errored
    )
      continue
    request = row
    requestCount++
  }
  if (requestCount !== 1 || !request)
    return {
      status: requestCount > 1 ? 'ambiguous' : 'unavailable',
      why: 'forward-request-identity',
    }
  let clientSocket: SocketRecord | null = null
  for (const row of snapshotRecords(join(output, client.basename)))
    if (
      row.kind === 'socket' &&
      row.id === request.socketId &&
      row.incarnation === request.incarnation
    )
      clientSocket = row
  if (
    !clientSocket ||
    !clientSocket.localPort ||
    !clientSocket.remotePort ||
    !clientSocket.localFamily ||
    !clientSocket.remoteFamily
  )
    return { status: 'unavailable', why: 'client-socket-incarnation' }
  if (BigInt(serving.coverage.evictedSocketThrough) >= BigInt(clientSocket.opened[1]))
    return { status: 'unavailable', why: 'peer-incarnation-history-evicted' }
  let servingSocket: SocketRecord | null = null,
    peerCount = 0
  for (const row of snapshotRecords(join(output, serving.basename))) {
    if (
      row.kind !== 'socket' ||
      row.localFamily !== clientSocket.remoteFamily ||
      row.remoteFamily !== clientSocket.localFamily ||
      row.localPort !== clientSocket.remotePort ||
      row.remotePort !== clientSocket.localPort
    )
      continue
    if (row.closed && BigInt(row.closed[1]) < BigInt(clientSocket.opened[1])) continue
    if (clientSocket.closed && BigInt(row.opened[1]) > BigInt(clientSocket.closed[1])) continue
    servingSocket = row
    peerCount++
  }
  if (peerCount !== 1 || !servingSocket)
    return {
      status: peerCount > 1 ? 'ambiguous' : 'unavailable',
      why: 'reversed-endpoint-incarnation',
    }
  let servingRequest: RequestRecord | null = null,
    ingressCount = 0
  for (const row of snapshotRecords(join(output, serving.basename))) {
    if (
      row.kind !== 'request' ||
      row.socketId !== servingSocket.id ||
      row.incarnation !== servingSocket.incarnation ||
      row.order !== request.order ||
      row.path !== request.path
    )
      continue
    servingRequest = row
    ingressCount++
  }
  if (ingressCount !== 1 || !servingRequest)
    return {
      status: ingressCount > 1 ? 'ambiguous' : 'unavailable',
      why: 'serving-request-order',
    }
  if (
    request.repeated ||
    clientSocket.repeated ||
    servingRequest.repeated ||
    servingSocket.repeated
  )
    return { status: 'unavailable', why: 'lifecycle-history-compacted' }
  return {
    status: 'exact',
    client: request,
    clientSocket,
    serving: servingRequest,
    servingSocket,
  }
}

export function removeRetentionSocketJournal(name: string) {
  if (isRetentionSocketJournalName(name)) guard(() => unlinkSync(join(tmpdir(), name)))
}
