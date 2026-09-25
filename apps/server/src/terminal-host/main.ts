import { timingSafeEqual } from 'node:crypto'
import { chmodSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { parseArgs } from 'node:util'
import type { PtyExit } from '@workspace/pty'
import * as v from 'valibot'

import {
  clientControlSchema,
  encodeControl,
  encodeOutput,
  ensureSocketDirectory,
  ensureToken,
  FrameDecoder,
  HOST_CAPABILITIES,
  hostPaths,
  PROTOCOL_VERSION,
  type ClientControl,
  type Frame,
  type HostControl,
  type HostPaths,
} from './protocol'
import { HostSession, type SessionSubscriber } from './session'

const DEFAULT_IDLE_MS = 30_000
const SHUTDOWN_GRACE_MS = 2_000

type SpawnControl = Extract<ClientControl, { type: 'spawn' }>
type AttachControl = Extract<ClientControl, { type: 'attach' }>

/** Owns every PTY for one state root, so shells outlive the server that asked for them. */
class TerminalHost {
  private readonly sessions = new Map<number, HostSession>()
  private readonly byKey = new Map<string, HostSession>()
  private readonly clients = new Set<HostConnection>()
  private readonly startedAt = new Date().toISOString()
  private readonly cgroup = readCgroup()
  private readonly paths: HostPaths
  private readonly token: Buffer
  private readonly idleMs: number
  private server: net.Server | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private nextSession = 1
  private stopping = false

  constructor(paths: HostPaths, token: string, idleMs: number) {
    this.paths = paths
    this.token = Buffer.from(token)
    this.idleMs = idleMs
  }

  async listen() {
    ensureSocketDirectory(this.paths)
    if (await socketAnswers(this.paths.socket)) return false
    rmSync(this.paths.socket, { force: true })
    const server = net.createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.paths.socket, () => resolve())
    })
    chmodSync(this.paths.socket, 0o600)
    this.server = server
    this.writeManifest()
    this.checkIdle()
    return true
  }

  hello(connection: HostConnection, token: string, version: number): HostControl {
    if (!this.tokenMatches(token))
      return { type: 'refused', reason: 'token', version: PROTOCOL_VERSION }
    if (version !== PROTOCOL_VERSION)
      return { type: 'refused', reason: 'version', version: PROTOCOL_VERSION }
    this.clients.add(connection)
    this.checkIdle()
    return {
      type: 'hello',
      version: PROTOCOL_VERSION,
      capabilities: [...HOST_CAPABILITIES],
      pid: process.pid,
      cgroup: this.cgroup,
      startedAt: this.startedAt,
    }
  }

  spawn(connection: HostConnection, control: SpawnControl): HostControl {
    // A key names one shell: a spawn for a key that still has one replaces it.
    this.byKey.get(control.key)?.pty.kill()
    const [program, ...args] = control.command
    if (program === undefined)
      return { type: 'error', request: control.request, code: 'invalid', message: 'No command.' }
    const session = new HostSession({
      id: this.nextSession++,
      key: control.key,
      command: [program, ...args],
      cwd: control.cwd,
      env: control.env,
      cols: control.cols,
      rows: control.rows,
      onExit: (ended) => this.ended(ended),
    })
    this.sessions.set(session.id, session)
    this.byKey.set(session.key, session)
    session.subscribe(connection)
    this.writeManifest()
    this.checkIdle()
    return {
      type: 'spawned',
      request: control.request,
      key: session.key,
      session: session.id,
      pid: session.pid,
    }
  }

  attach(connection: HostConnection, control: AttachControl) {
    const session = this.byKey.get(control.key)
    if (!session) {
      connection.send({
        type: 'error',
        request: control.request,
        code: 'unknown-key',
        message: 'No terminal with that key.',
      })
      return
    }
    connection.send({
      type: 'attached',
      request: control.request,
      key: session.key,
      session: session.id,
      pid: session.pid,
    })
    session.attach(connection, control.from)
    if (session.exit) this.forget(session)
  }

  session(id: number) {
    return this.sessions.get(id)
  }

  list() {
    return [...this.sessions.values()].map((session) => session.info())
  }

  disconnect(connection: HostConnection) {
    this.clients.delete(connection)
    for (const session of this.sessions.values()) session.unsubscribe(connection)
    this.checkIdle()
  }

  async shutdown() {
    if (this.stopping) return
    this.stopping = true
    const live = [...this.sessions.values()].filter((session) => !session.exit)
    for (const session of live) session.pty.kill()
    const exits = Promise.allSettled(live.map((session) => session.pty.exited))
    await Promise.race([exits, Bun.sleep(SHUTDOWN_GRACE_MS)])
    for (const client of this.clients) client.close()
    this.server?.close()
    this.cleanup()
    process.exit(0)
  }

  private ended(session: HostSession) {
    // An exit someone saw, or of a replaced shell, is done; an unseen one waits for an attach.
    if (session.subscriberCount > 0 || this.byKey.get(session.key) !== session) this.forget(session)
    this.writeManifest()
    this.checkIdle()
  }

  private forget(session: HostSession) {
    this.sessions.delete(session.id)
    if (this.byKey.get(session.key) === session) this.byKey.delete(session.key)
  }

  private checkIdle() {
    const live = [...this.sessions.values()].some((session) => !session.exit)
    if (live || this.clients.size > 0) {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = null
      return
    }
    this.idleTimer ??= setTimeout(() => void this.shutdown(), this.idleMs)
  }

  private tokenMatches(token: string) {
    const offered = Buffer.from(token)
    return offered.byteLength === this.token.byteLength && timingSafeEqual(offered, this.token)
  }

  private accept(socket: net.Socket) {
    if (this.stopping) {
      socket.destroy()
      return
    }
    new HostConnection(this, socket)
  }

  // Beside the socket, so a server that cannot speak this protocol can still name the shells.
  private writeManifest() {
    if (this.stopping) return
    const live = [...this.sessions.values()].filter((session) => !session.exit)
    const entries = live.map(({ key, pid, startedAt }) => ({ key, pid, startedAt }))
    const staging = `${this.paths.manifest}.${process.pid}`
    writeFileSync(staging, `${JSON.stringify({ hostPid: process.pid, sessions: entries })}\n`, {
      mode: 0o600,
    })
    renameSync(staging, this.paths.manifest)
  }

  private cleanup() {
    rmSync(this.paths.socket, { force: true })
    rmSync(this.paths.manifest, { force: true })
    try {
      rmdirSync(this.paths.directory)
    } catch {
      // Another version's socket may still live there.
    }
  }
}

class HostConnection implements SessionSubscriber {
  private readonly host: TerminalHost
  private readonly socket: net.Socket
  private readonly decoder = new FrameDecoder()
  private authenticated = false

  constructor(host: TerminalHost, socket: net.Socket) {
    this.host = host
    this.socket = socket
    socket.on('data', (chunk) => this.receive(chunk))
    socket.on('error', () => socket.destroy())
    socket.on('close', () => this.host.disconnect(this))
  }

  send(message: HostControl) {
    this.write(encodeControl(message))
  }

  close() {
    this.socket.destroy()
  }

  output(session: HostSession, offset: number, bytes: Uint8Array) {
    this.write(encodeOutput(session.id, offset, bytes))
  }

  gap(session: HostSession, from: number, to: number) {
    this.send({ type: 'gap', session: session.id, from, to })
  }

  exited(session: HostSession, exit: PtyExit) {
    this.send({ type: 'exited', session: session.id, exitCode: exit.exitCode, signal: exit.signal })
  }

  private write(bytes: Uint8Array) {
    if (this.socket.destroyed) return
    this.socket.write(bytes)
  }

  private receive(chunk: Uint8Array | string) {
    try {
      for (const frame of this.decoder.push(chunk)) this.handle(frame)
    } catch (error) {
      this.send({ type: 'error', code: 'protocol', message: errorText(error) })
      this.socket.end()
    }
  }

  private handle(frame: Frame) {
    if (frame.type === 'output') return
    if (frame.type === 'input') {
      if (this.authenticated) this.host.session(frame.session)?.pty.write(frame.bytes)
      return
    }
    const parsed = v.safeParse(clientControlSchema, frame.message)
    if (!parsed.success) {
      this.send({ type: 'error', code: 'invalid', message: 'Unreadable control message.' })
      return
    }
    this.control(parsed.output)
  }

  private control(control: ClientControl) {
    if (control.type === 'hello') return this.hello(control)
    if (!this.authenticated) {
      this.socket.end()
      return
    }
    try {
      this.command(control)
    } catch (error) {
      const request = 'request' in control ? control.request : undefined
      this.send({ type: 'error', request, code: errorCode(error), message: errorText(error) })
    }
  }

  private hello(control: Extract<ClientControl, { type: 'hello' }>) {
    const reply = this.host.hello(this, control.token, control.version)
    this.send(reply)
    if (reply.type === 'refused') {
      this.socket.end()
      return
    }
    this.authenticated = true
  }

  private command(control: Exclude<ClientControl, { type: 'hello' }>) {
    if (control.type === 'spawn') return this.send(this.host.spawn(this, control))
    if (control.type === 'attach') return this.host.attach(this, control)
    if (control.type === 'list')
      return this.send({ type: 'list', request: control.request, sessions: this.host.list() })
    if (control.type === 'shutdown') return void this.host.shutdown()

    const session = this.host.session(control.session)
    if (!session || session.exit) return
    if (control.type === 'resize') return session.pty.resize(control.cols, control.rows)
    if (control.type === 'kill') return session.pty.kill(control.signal)
    process.kill(session.pid, control.signal)
  }
}

function socketAnswers(socketPath: string) {
  return new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
}

function readCgroup() {
  if (process.platform !== 'linux') return null
  try {
    return readFileSync('/proc/self/cgroup', 'utf8').trim()
  } catch {
    return null
  }
}

function errorCode(error: unknown) {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return 'failed'
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Terminal host operation failed.'
}

function hostArguments() {
  const { values } = parseArgs({
    options: { 'state-root': { type: 'string' }, 'idle-ms': { type: 'string' } },
  })
  const stateRoot = values['state-root']
  if (!stateRoot) return null
  const idleMs = Number(values['idle-ms'] ?? DEFAULT_IDLE_MS)
  return { stateRoot, idleMs: Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : DEFAULT_IDLE_MS }
}

async function main() {
  const options = hostArguments()
  if (!options) process.exit(2)
  process.title = 'platform-pty-host'
  const paths = hostPaths(options.stateRoot)
  const host = new TerminalHost(paths, ensureToken(paths), options.idleMs)
  // Another host already serves this state root.
  if (!(await host.listen())) process.exit(0)
  process.on('SIGHUP', () => {})
  process.once('SIGTERM', () => void host.shutdown())
  process.once('SIGINT', () => void host.shutdown())
}

if (import.meta.main) await main()
