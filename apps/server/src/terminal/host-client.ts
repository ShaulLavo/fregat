import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Pty, PtyExit } from '@workspace/pty'
import { elapsedMs } from '@workspace/utils/timing'
import { errorStringField } from '@workspace/contracts'
import * as v from 'valibot'

import { PTY_HOST } from '../installation/release-files'
import { recordProcessInfo } from '../observability'
import {
  encodeControl,
  encodeInput,
  ensureToken,
  FrameDecoder,
  hostControlSchema,
  hostPaths,
  hostSignalSchema,
  PROTOCOL_VERSION,
  protocolError,
  terminalHostErrors,
  type ClientControl,
  type Frame,
  type HostControl,
  type HostSessionInfo,
} from '../terminal-host/protocol'
import type { TerminalPtyFactory, TerminalPtyOptions } from './service'
import { hostIdentityMatches, processStart, readHostIdentity } from '../terminal-host/identity'
import { launchHost } from '../terminal-host/launch'

const CONNECT_TIMEOUT_MS = 5_000
const CONNECT_RETRY_MS = 25
const REQUEST_TIMEOUT_MS = 10_000
// The host never reports an exit it did not see; this matches its own unknown-exit convention.
const GONE_EXIT: PtyExit = { exitCode: 1, signal: null }

export type HostLauncher = (argv: readonly string[], env: NodeJS.ProcessEnv) => void | Promise<void>

export type TerminalHostClientOptions = {
  /** The state root whose host this client talks to (`PLATFORM_HOME`). */
  readonly stateRoot: string
  /** The host's environment; also where `XDG_RUNTIME_DIR` is read. */
  readonly env?: NodeJS.ProcessEnv
  readonly idleMs?: number
  readonly launch?: HostLauncher
  /** How long one request waits for its reply before the connection is dropped. */
  readonly requestTimeoutMs?: number
}

export type HostAttachOptions = {
  readonly key: string
  readonly session?: number
  readonly from: number
  readonly onData: (bytes: Uint8Array, offset: number) => void
  readonly onGap?: (from: number, to: number) => void
}

type HostHello = Extract<HostControl, { type: 'hello' }>
type Connected = { readonly connection: HostConnection; readonly hello: HostHello }
type Reply = Extract<HostControl, { request?: number }>
type Pending = {
  readonly operation: string
  settle(reply: Reply): void
  fail(error: unknown): void
}
type PtyHandlers = Pick<HostAttachOptions, 'onData' | 'onGap'>
type Resumed = 'resumed' | 'gone' | 'failed'

/** Connects to this state root's terminal host, launching it when nothing answers. */
export class TerminalHostClient {
  private readonly stateRoot: string
  private readonly env: NodeJS.ProcessEnv
  private readonly idleMs: number | undefined
  private readonly launch: HostLauncher
  private readonly requestTimeoutMs: number
  private connecting: Promise<Connected> | null = null
  private generation = 0
  private detaches = 0
  private description: HostHello | null = null

  constructor({
    stateRoot,
    env = process.env,
    idleMs,
    launch = launchHost,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  }: TerminalHostClientOptions) {
    this.stateRoot = stateRoot
    this.env = env
    this.idleMs = idleMs
    this.launch = launch
    this.requestTimeoutMs = requestTimeoutMs
  }

  /** Last authenticated host, without starting one for a release probe. */
  info() {
    return this.description
  }

  /** The host's hello: its pid, cgroup and protocol. */
  async host() {
    return (await this.connection()).hello
  }

  async spawn(options: TerminalPtyOptions): Promise<HostPty> {
    const { connection } = await this.connection()
    return connection.spawn(options)
  }

  async attach(options: HostAttachOptions): Promise<HostPty> {
    const { connection } = await this.connection()
    return connection.attach(options)
  }

  async list(): Promise<readonly HostSessionInfo[]> {
    const { connection } = await this.connection()
    return connection.list()
  }

  /** Kills a host session by its numeric id, without attaching to it first. */
  async killSession(session: number, signal?: NodeJS.Signals) {
    const { connection } = await this.connection()
    connection.send({ type: 'kill', session, signal: signal ? hostSignal(signal) : undefined })
  }

  /** Ends every shell and the host itself. */
  async shutdown() {
    if (!this.connecting) return
    const { connection } = await this.connecting
    connection.send({ type: 'shutdown' })
    this.close()
  }

  /** Drops the connection; the host keeps every shell. */
  close() {
    const connecting = this.connecting
    this.connecting = null
    this.description = null
    this.generation += 1
    this.detaches += 1
    void connecting?.then(
      ({ connection }) => connection.close(),
      () => {},
    )
  }

  private connection() {
    this.connecting ??= this.open(++this.generation).catch((error: unknown) => {
      this.connecting = null
      throw error
    })
    return this.connecting
  }

  private async open(generation: number): Promise<Connected> {
    const paths = hostPaths(this.stateRoot, this.env)
    const token = ensureToken(paths)
    const startedAt = performance.now()
    let launched = false
    let attempts = 0
    for (;;) {
      attempts += 1
      const socket = await connectSocket(paths.socket)
      const connected = socket
        ? await this.handshake(socket, token, generation, CONNECT_TIMEOUT_MS - elapsedMs(startedAt))
        : null
      if (connected) {
        const identity = readHostIdentity(paths.manifest)
        if (
          !identity ||
          identity.hostPid !== connected.hello.pid ||
          !hostIdentityMatches(identity)
        ) {
          connected.connection.close()
          throw terminalHostErrors.HOST_UNREACHABLE({
            internal: {
              reason: 'host-identity-mismatch',
              hostPid: connected.hello.pid,
              recordedIdentity: identity,
              processStart: processStart(connected.hello.pid),
            },
          })
        }
        this.description = connected.hello
        const sessions = await connected.connection.list()
        recordProcessInfo(launched ? 'terminal.host.launch' : 'terminal.host.adopt', {
          area: 'terminal',
          attempts,
          keyCount: sessions.length,
          build: connected.hello.build,
          cgroup: connected.hello.cgroup,
          durationMs: elapsedMs(startedAt),
          hostPid: connected.hello.pid,
          launched,
          protocol: connected.hello.version,
        })
        return connected
      }
      if (!socket && !launched) {
        await this.launch(this.hostArgv(), this.env)
        launched = true
      }
      if (elapsedMs(startedAt) > CONNECT_TIMEOUT_MS)
        throw terminalHostErrors.HOST_UNREACHABLE({
          internal: { attempts, elapsedMs: elapsedMs(startedAt), launched, socket: paths.socket },
        })
      await Bun.sleep(CONNECT_RETRY_MS)
    }
  }

  private async handshake(
    socket: net.Socket,
    token: string,
    generation: number,
    timeoutMs: number,
  ) {
    try {
      return await HostConnection.handshake(socket, token, {
        onClose: (orphans) => {
          if (this.generation === generation && this.description) {
            this.connecting = null
            this.description = null
          }
          if (orphans.length > 0) void this.recover(orphans)
        },
        timeoutMs: Math.max(1, timeoutMs),
        requestTimeoutMs: this.requestTimeoutMs,
      })
    } catch (error) {
      if (errorStringField(error, 'code') !== terminalHostErrors.HOST_UNREACHABLE.code) throw error
      return null
    }
  }

  /** A dropped connection hands over its shells: listed ones resume from their offset, the rest exited. */
  private async recover(orphans: readonly HostPty[]) {
    const detaches = this.detaches
    const startedAt = performance.now()
    try {
      const { connection, hello } = await this.connection()
      const sessions = await connection.list()
      const results = await Promise.all(
        orphans.map((pty) => this.resume(connection, pty, sessions, detaches)),
      )
      recordProcessInfo('terminal.host.reconnect', {
        area: 'terminal',
        durationMs: elapsedMs(startedAt),
        hostPid: hello.pid,
        keyCount: orphans.length,
        resumed: results.filter((result) => result === 'resumed').length,
        gone: results.filter((result) => result === 'gone').length,
        failed: results.filter((result) => result === 'failed').length,
      })
    } catch (cause) {
      for (const pty of orphans) this.lost(pty, cause, detaches)
    }
  }

  private async resume(
    connection: HostConnection,
    pty: HostPty,
    sessions: readonly HostSessionInfo[],
    detaches: number,
  ): Promise<Resumed> {
    const listed = sessions.some((info) => info.key === pty.key && info.session === pty.session)
    if (!listed) {
      pty.finish(GONE_EXIT)
      return 'gone'
    }
    try {
      await connection.resume(pty)
      return 'resumed'
    } catch (cause) {
      this.lost(pty, cause, detaches)
      return 'failed'
    }
  }

  // After `close()` the shell is detached on purpose and keeps its offset for a later attach.
  private lost(pty: HostPty, cause: unknown, detaches: number) {
    if (this.detaches !== detaches) return
    pty.fail(
      terminalHostErrors.HOST_UNREACHABLE({
        ...(cause instanceof Error ? { cause } : {}),
        internal: {
          reason: 'reconnect-failed',
          key: pty.key,
          session: pty.session,
          code: errorStringField(cause, 'code') ?? null,
        },
      }),
    )
  }

  private hostArgv() {
    const argv = [process.execPath, hostEntry(), `--state-root=${this.stateRoot}`]
    if (this.idleMs !== undefined) argv.push(`--idle-ms=${this.idleMs}`)
    return argv
  }
}

export function hostPtyFactory(client: TerminalHostClient): TerminalPtyFactory {
  return (options) => client.spawn(options)
}

type ConnectionOptions = {
  /** Gets the shells a connection lost without being asked to close; empty otherwise. */
  readonly onClose: (orphans: readonly HostPty[]) => void
  readonly timeoutMs: number
  readonly requestTimeoutMs: number
}

class HostConnection {
  private readonly socket: net.Socket
  private readonly decoder = new FrameDecoder()
  private readonly requests = new Map<number, Pending>()
  private readonly ptys = new Map<number, HostPty>()
  private readonly greeting = Promise.withResolvers<HostHello>()
  private readonly onClose: ConnectionOptions['onClose']
  private readonly requestTimeoutMs: number
  private nextRequest = 1
  private closedByUs = false
  private ended = false

  private constructor(socket: net.Socket, options: ConnectionOptions) {
    this.socket = socket
    this.onClose = options.onClose
    this.requestTimeoutMs = options.requestTimeoutMs
    socket.on('data', (chunk) => this.receive(chunk))
    socket.on('error', () => socket.destroy())
    // The host only ends a connection it is done with; waiting on the half-open side can stall.
    socket.on('end', () => socket.destroy())
    socket.on('close', () => this.closed())
  }

  static async handshake(socket: net.Socket, token: string, options: ConnectionOptions) {
    const { timeoutMs } = options
    const connection = new HostConnection(socket, options)
    connection.send({ type: 'hello', version: PROTOCOL_VERSION, token, capabilities: [] })
    const timeout = setTimeout(
      () =>
        connection.fail(
          terminalHostErrors.HOST_UNREACHABLE({
            internal: { reason: 'hello-timeout' },
          }),
        ),
      timeoutMs,
    )
    try {
      const hello = await connection.greeting.promise
      return { connection, hello }
    } finally {
      clearTimeout(timeout)
    }
  }

  send(control: ClientControl) {
    this.write(encodeControl(control))
  }

  write(bytes: Uint8Array) {
    if (!this.socket.destroyed) this.socket.write(bytes)
  }

  /** Flushes queued frames, then closes. */
  close() {
    this.closedByUs = true
    this.socket.end()
  }

  spawn(options: TerminalPtyOptions) {
    const { key, command, cwd, cols, rows, onData } = options
    return this.request<HostPty>(
      'spawn',
      (request) => ({
        type: 'spawn',
        request,
        key,
        command: [...command],
        cwd,
        env: definedEnv(options.env ?? process.env),
        cols: cols ?? 80,
        rows: rows ?? 24,
      }),
      (reply) => this.adopt(reply, { onData }),
    )
  }

  attach({ key, session, from, onData, onGap }: HostAttachOptions) {
    return this.request<HostPty>(
      'attach',
      (request) => ({ type: 'attach', request, key, session, from }),
      (reply) => {
        if (reply.type === 'attached') this.recordAttach(reply)
        return this.adopt(reply, { onData, onGap }, from)
      },
    )
  }

  list() {
    return this.request<readonly HostSessionInfo[]>(
      'list',
      (request) => ({ type: 'list', request }),
      (reply) => {
        if (reply.type !== 'list') throw protocolError(reply.type, 'list')
        return reply.sessions
      },
    )
  }

  /** Moves a shell from a lost connection onto this one, replaying from the offset it reached. */
  resume(pty: HostPty) {
    return this.request<void>(
      'attach',
      (request) => ({
        type: 'attach',
        request,
        key: pty.key,
        session: pty.session,
        from: pty.offset,
      }),
      (reply) => {
        if (reply.type !== 'attached') throw protocolError(reply.type, 'attached')
        this.recordAttach(reply)
        this.ptys.set(reply.session, pty)
        pty.rebind(this)
      },
    )
  }

  private recordAttach(reply: Extract<HostControl, { type: 'attached' }>) {
    void this.greeting.promise.then((hello) =>
      recordProcessInfo('terminal.host.attach', {
        area: 'terminal',
        key: reply.key,
        keyCount: 1,
        replayedBytes: reply.replayedBytes,
        gapBytes: reply.gapBytes,
        hostPid: hello.pid,
        cgroup: hello.cgroup,
        protocol: hello.version,
      }),
    )
  }

  private request<T>(
    operation: string,
    control: (request: number) => ClientControl,
    accept: (reply: Reply) => T,
  ) {
    const request = this.nextRequest++
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    const deadline = setTimeout(() => this.timedOut(request), this.requestTimeoutMs)
    this.requests.set(request, {
      operation,
      // Runs inside the frame loop, so a pty is registered before its first output frame.
      settle: (reply) => {
        clearTimeout(deadline)
        try {
          resolve(accept(reply))
        } catch (error) {
          reject(error)
        }
      },
      fail: (error) => {
        clearTimeout(deadline)
        reject(error)
      },
    })
    this.send(control(request))
    return promise
  }

  // A host that stops answering is dropped; its shells resume on the next connection.
  private timedOut(request: number) {
    const pending = this.requests.get(request)
    if (!pending) return
    this.requests.delete(request)
    pending.fail(
      terminalHostErrors.HOST_UNREACHABLE({
        internal: {
          reason: 'request-timeout',
          operation: pending.operation,
          timeoutMs: this.requestTimeoutMs,
        },
      }),
    )
    this.socket.destroy()
    // Now, before the close event: the next request must not reach this dead socket.
    this.closed()
  }

  private adopt(reply: Reply, handlers: PtyHandlers, from = 0) {
    if (reply.type !== 'spawned' && reply.type !== 'attached')
      throw protocolError(reply.type, 'spawned or attached')
    const pty = new HostPty(this, reply, handlers, from)
    this.ptys.set(reply.session, pty)
    return pty
  }

  private receive(chunk: Uint8Array | string) {
    // After a detach the ptys keep the offset they had, which is where a later attach resumes.
    if (this.closedByUs) return
    try {
      for (const frame of this.decoder.push(chunk)) this.handle(frame)
    } catch (error) {
      this.fail(error)
    }
  }

  private handle(frame: Frame) {
    if (frame.type === 'output') {
      this.ptys.get(frame.session)?.receive(frame.offset, frame.bytes)
      return
    }
    if (frame.type === 'input')
      throw protocolError('input frame from the host', 'output or control')
    const parsed = v.safeParse(hostControlSchema, frame.message)
    if (!parsed.success) throw protocolError('unreadable control', 'host control')
    this.control(parsed.output)
  }

  private control(control: HostControl) {
    if (control.type === 'hello') return this.greeting.resolve(control)
    if (control.type === 'refused') return this.refused(control)
    if (control.type === 'gap') return this.ptys.get(control.session)?.gap(control.from, control.to)
    if (control.type === 'exited') return this.exited(control)
    if (control.request === undefined) return
    const pending = this.requests.get(control.request)
    if (!pending) return
    this.requests.delete(control.request)
    if (control.type !== 'error') return pending.settle(control)
    pending.fail(
      terminalHostErrors.HOST_REQUEST_FAILED({
        message: control.message,
        internal: { code: control.code, operation: pending.operation },
      }),
    )
  }

  private refused(control: Extract<HostControl, { type: 'refused' }>) {
    if (control.reason === 'version') {
      this.fail(protocolError(control.version, PROTOCOL_VERSION))
      return
    }
    this.fail(terminalHostErrors.HOST_REFUSED({ internal: { reason: control.reason } }))
  }

  private exited(control: Extract<HostControl, { type: 'exited' }>) {
    const pty = this.ptys.get(control.session)
    this.ptys.delete(control.session)
    // The host reports the runtime's own signal name.
    pty?.finish({ exitCode: control.exitCode, signal: control.signal as NodeJS.Signals | null })
  }

  private fail(error: unknown) {
    this.greeting.reject(error)
    for (const pending of this.requests.values()) pending.fail(error)
    for (const pty of this.ptys.values()) pty.fail(error)
    this.requests.clear()
    this.ptys.clear()
    this.closedByUs = true
    this.socket.destroy()
  }

  private closed() {
    if (this.ended) return
    this.ended = true
    if (this.closedByUs) return this.onClose([])
    const orphans = [...this.ptys.values()]
    const error = terminalHostErrors.HOST_UNREACHABLE({
      internal: {
        reason: 'connection-closed',
        pendingRequests: this.requests.size,
        sessions: orphans.length,
      },
    })
    this.greeting.reject(error)
    for (const pending of this.requests.values()) pending.fail(error)
    this.requests.clear()
    this.ptys.clear()
    this.closedByUs = true
    this.onClose(orphans)
  }
}

/** A shell in the host, driven over the socket. `pid` is the real shell's pid. */
export class HostPty implements Pty {
  readonly pid: number
  readonly key: string
  readonly session: number
  readonly exited: Promise<PtyExit>
  /** The end of the output this client has received; the next frame starts here. */
  offset: number
  private connection: HostConnection
  private readonly handlers: PtyHandlers
  private readonly completion = Promise.withResolvers<PtyExit>()
  private done = false
  // Resent after a reconnect: a kill sent while the connection was down never arrived.
  private killSignal: NodeJS.Signals | null = null

  constructor(
    connection: HostConnection,
    reply: { key: string; session: number; pid: number },
    handlers: PtyHandlers,
    from: number,
  ) {
    this.connection = connection
    this.handlers = handlers
    this.key = reply.key
    this.session = reply.session
    this.pid = reply.pid
    this.offset = from
    this.exited = this.completion.promise
  }

  write(data: string | Uint8Array) {
    if (this.done) return
    this.connection.write(encodeInput(this.session, data))
  }

  resize(cols: number, rows: number) {
    if (this.done) return
    this.connection.send({ type: 'resize', session: this.session, cols, rows })
  }

  kill(signal: NodeJS.Signals = 'SIGHUP') {
    if (this.done) return
    this.killSignal = signal
    this.connection.send({ type: 'kill', session: this.session, signal: hostSignal(signal) })
  }

  rebind(connection: HostConnection) {
    this.connection = connection
    if (this.killSignal) this.kill(this.killSignal)
  }

  async [Symbol.asyncDispose]() {
    this.kill()
    await this.exited
  }

  receive(offset: number, bytes: Uint8Array) {
    this.offset = offset + bytes.byteLength
    this.handlers.onData(bytes, offset)
  }

  gap(from: number, to: number) {
    this.offset = to
    this.handlers.onGap?.(from, to)
  }

  finish(exit: PtyExit) {
    this.done = true
    this.completion.resolve(exit)
  }

  fail(error: unknown) {
    this.done = true
    this.completion.reject(error)
  }
}

function hostSignal(signal: NodeJS.Signals) {
  const parsed = v.safeParse(hostSignalSchema, signal)
  if (!parsed.success) throw protocolError(signal, 'a signal the host forwards')
  return parsed.output
}

function definedEnv(env: Readonly<Record<string, string | undefined>>) {
  const defined: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) defined[name] = value
  }
  return defined
}

// The bundle ships the host beside itself; source runs the entry directly.
function hostEntry() {
  const bundled = path.join(import.meta.dirname, PTY_HOST)
  if (existsSync(bundled)) return bundled
  return path.join(import.meta.dirname, '../terminal-host/main.ts')
}

function connectSocket(socketPath: string) {
  return new Promise<net.Socket | null>((resolve) => {
    const socket = net.connect(socketPath)
    const refuse = () => {
      socket.destroy()
      resolve(null)
    }
    socket.once('error', refuse)
    socket.once('connect', () => {
      socket.off('error', refuse)
      resolve(socket)
    })
  })
}
