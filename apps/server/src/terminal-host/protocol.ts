import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineErrorCatalog } from 'evlog'
import * as v from 'valibot'

/** In the socket name, so a host speaking another version is never reached by accident. */
export const PROTOCOL_VERSION = 1
export const HOST_CAPABILITIES: readonly string[] = []
/** Per-session output the host keeps for a server that is away. */
export const RING_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 16 * 1024 * 1024

const FRAME_CONTROL = 0
const FRAME_OUTPUT = 1
const FRAME_INPUT = 2
// [length u32][type u8]; output adds [session u32][offset u64], input adds [session u32].
const LENGTH_BYTES = 4
const OUTPUT_HEADER_BYTES = 1 + 4 + 8
const INPUT_HEADER_BYTES = 1 + 4

export const terminalHostErrors = defineErrorCatalog('terminal', {
  HOST_UNREACHABLE: {
    status: 503,
    message: 'The terminal host did not answer.',
    why: 'The process that keeps terminals running could not be started or reached on its socket.',
    fix: 'Open the terminal again. If it still fails, check the server log for the terminal host.',
  },
  HOST_PROTOCOL: {
    status: 502,
    message: 'The terminal host speaks a different protocol.',
    why: 'The terminal host sent a version or a frame this server cannot read.',
    fix: 'Close every terminal so the host exits, then open the terminal again.',
  },
  HOST_REFUSED: {
    status: 403,
    message: 'The terminal host refused this server.',
    why: 'The host for this state home holds a different token than the one this server read.',
    fix: 'End the terminal host process for this state home, then open the terminal again.',
  },
  HOST_REQUEST_FAILED: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'The terminal host could not start, find or change the shell.',
    fix: 'Check the configured shell and the worktree directory, then open the terminal again.',
  },
})

export function protocolError(observed: string | number, expected: string | number) {
  return terminalHostErrors.HOST_PROTOCOL({ internal: { observed, expected } })
}

export type HostPaths = {
  readonly directory: string
  readonly socket: string
  readonly manifest: string
  readonly token: string
}

/**
 * One host per state root. The socket sits in a private runtime directory keyed by a hash of the
 * root; without `XDG_RUNTIME_DIR` (macOS, containers) it lives under the root itself.
 */
export function hostPaths(stateRoot: string, env: NodeJS.ProcessEnv = process.env): HostPaths {
  const root = path.resolve(stateRoot)
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16)
  const directory = env.XDG_RUNTIME_DIR
    ? path.join(env.XDG_RUNTIME_DIR, 'platform-pty', hash)
    : path.join(root, 'pty-host')
  return {
    directory,
    socket: path.join(directory, `v${PROTOCOL_VERSION}.sock`),
    manifest: path.join(directory, 'sessions.json'),
    token: path.join(root, 'pty-host.token'),
  }
}

export function ensureSocketDirectory(paths: HostPaths) {
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 })
  chmodSync(paths.directory, 0o700)
}

/** Created once by whichever side needs it first; both sides then read the same file. */
export function ensureToken(paths: HostPaths) {
  mkdirSync(path.dirname(paths.token), { recursive: true })
  try {
    writeFileSync(paths.token, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!isErrnoCode(error, 'EEXIST')) throw error
  }
  return readFileSync(paths.token, 'utf8').trim()
}

function isErrnoCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

export const hostSignalSchema = v.picklist([
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGTERM',
  'SIGKILL',
  'SIGTSTP',
  'SIGCONT',
  'SIGWINCH',
  'SIGUSR1',
  'SIGUSR2',
])
const sessionSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(0xffff_ffff))
const offsetSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
const requestSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
const dimensionSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535))

export const clientControlSchema = v.variant('type', [
  v.object({
    type: v.literal('hello'),
    version: v.number(),
    token: v.string(),
    capabilities: v.array(v.string()),
  }),
  v.object({
    type: v.literal('spawn'),
    request: requestSchema,
    key: v.string(),
    command: v.pipe(v.array(v.string()), v.minLength(1)),
    cwd: v.optional(v.string()),
    env: v.record(v.string(), v.string()),
    cols: dimensionSchema,
    rows: dimensionSchema,
  }),
  v.object({
    type: v.literal('attach'),
    request: requestSchema,
    key: v.string(),
    session: v.optional(sessionSchema),
    from: offsetSchema,
  }),
  v.object({
    type: v.literal('resize'),
    session: sessionSchema,
    cols: dimensionSchema,
    rows: dimensionSchema,
  }),
  v.object({ type: v.literal('signal'), session: sessionSchema, signal: hostSignalSchema }),
  v.object({
    type: v.literal('kill'),
    session: sessionSchema,
    signal: v.optional(hostSignalSchema),
  }),
  v.object({ type: v.literal('list'), request: requestSchema }),
  v.object({ type: v.literal('shutdown') }),
])
export type ClientControl = v.InferOutput<typeof clientControlSchema>

const sessionInfoSchema = v.object({
  key: v.string(),
  session: sessionSchema,
  pid: v.number(),
  startedAt: v.string(),
  offset: offsetSchema,
  exited: v.boolean(),
})
export type HostSessionInfo = v.InferOutput<typeof sessionInfoSchema>

export const hostControlSchema = v.variant('type', [
  v.object({
    type: v.literal('hello'),
    version: v.number(),
    capabilities: v.array(v.string()),
    pid: v.number(),
    cgroup: v.nullable(v.string()),
    startedAt: v.string(),
    build: v.object({
      release: v.nullable(v.string()),
      commit: v.nullable(v.string()),
      dirtyFiles: v.nullable(v.number()),
    }),
  }),
  v.object({
    type: v.literal('refused'),
    reason: v.picklist(['token', 'version']),
    version: v.number(),
  }),
  v.object({
    type: v.literal('spawned'),
    request: requestSchema,
    key: v.string(),
    session: sessionSchema,
    pid: v.number(),
  }),
  v.object({
    type: v.literal('attached'),
    replayedBytes: offsetSchema,
    gapBytes: offsetSchema,
    request: requestSchema,
    key: v.string(),
    session: sessionSchema,
    pid: v.number(),
  }),
  v.object({
    type: v.literal('exited'),
    session: sessionSchema,
    exitCode: v.number(),
    signal: v.nullable(v.string()),
  }),
  v.object({
    type: v.literal('gap'),
    session: sessionSchema,
    from: offsetSchema,
    to: offsetSchema,
  }),
  v.object({
    type: v.literal('list'),
    request: requestSchema,
    sessions: v.array(sessionInfoSchema),
  }),
  v.object({
    type: v.literal('error'),
    request: v.optional(requestSchema),
    code: v.string(),
    message: v.string(),
  }),
])
export type HostControl = v.InferOutput<typeof hostControlSchema>

export type Frame =
  | { readonly type: 'control'; readonly message: unknown }
  | {
      readonly type: 'output'
      readonly session: number
      readonly offset: number
      readonly bytes: Uint8Array
    }
  | { readonly type: 'input'; readonly session: number; readonly bytes: Uint8Array }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeControl(message: ClientControl | HostControl): Uint8Array {
  const body = encoder.encode(JSON.stringify(message))
  const frame = allocateFrame(1 + body.byteLength)
  frame.bytes[LENGTH_BYTES] = FRAME_CONTROL
  frame.bytes.set(body, LENGTH_BYTES + 1)
  return frame.bytes
}

export function encodeOutput(session: number, offset: number, bytes: Uint8Array): Uint8Array {
  const frame = allocateFrame(OUTPUT_HEADER_BYTES + bytes.byteLength)
  frame.bytes[LENGTH_BYTES] = FRAME_OUTPUT
  frame.view.setUint32(LENGTH_BYTES + 1, session)
  frame.view.setBigUint64(LENGTH_BYTES + 5, BigInt(offset))
  frame.bytes.set(bytes, LENGTH_BYTES + OUTPUT_HEADER_BYTES)
  return frame.bytes
}

export function encodeInput(session: number, data: string | Uint8Array): Uint8Array {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const frame = allocateFrame(INPUT_HEADER_BYTES + bytes.byteLength)
  frame.bytes[LENGTH_BYTES] = FRAME_INPUT
  frame.view.setUint32(LENGTH_BYTES + 1, session)
  frame.bytes.set(bytes, LENGTH_BYTES + INPUT_HEADER_BYTES)
  return frame.bytes
}

function allocateFrame(length: number) {
  const bytes = new Uint8Array(LENGTH_BYTES + length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, length)
  return { bytes, view }
}

/** Splits a byte stream into frames; only a trailing partial frame is copied. */
export class FrameDecoder {
  private pending: Uint8Array = new Uint8Array(0)

  /** Takes a socket chunk as given; sockets here never set an encoding, so strings are bytes. */
  push(data: Uint8Array | string): Frame[] {
    const chunk = typeof data === 'string' ? encoder.encode(data) : data
    const bytes = this.pending.byteLength === 0 ? chunk : concat(this.pending, chunk)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const frames: Frame[] = []
    let cursor = 0
    while (bytes.byteLength - cursor >= LENGTH_BYTES) {
      const length = view.getUint32(cursor)
      if (length < 1 || length > MAX_FRAME_BYTES)
        throw protocolError(`frame length ${length}`, `1..${MAX_FRAME_BYTES}`)
      if (bytes.byteLength - cursor - LENGTH_BYTES < length) break
      const start = cursor + LENGTH_BYTES
      frames.push(decodeFrame(bytes.subarray(start, start + length)))
      cursor = start + length
    }
    this.pending = bytes.slice(cursor)
    return frames
  }
}

function decodeFrame(frame: Uint8Array): Frame {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const type = frame[0]
  if (type === FRAME_CONTROL) return { type: 'control', message: parseJson(frame.subarray(1)) }
  if (type === FRAME_OUTPUT && frame.byteLength >= OUTPUT_HEADER_BYTES)
    return {
      type: 'output',
      session: view.getUint32(1),
      offset: Number(view.getBigUint64(5)),
      bytes: frame.subarray(OUTPUT_HEADER_BYTES),
    }
  if (type === FRAME_INPUT && frame.byteLength >= INPUT_HEADER_BYTES)
    return { type: 'input', session: view.getUint32(1), bytes: frame.subarray(INPUT_HEADER_BYTES) }

  throw protocolError(`frame type ${type} of ${frame.byteLength} bytes`, 'control, output or input')
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw protocolError('control frame that is not JSON', 'JSON control')
  }
}

function concat(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left)
  joined.set(right, left.byteLength)
  return joined
}
