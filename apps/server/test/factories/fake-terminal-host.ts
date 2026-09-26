import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'

import { TerminalHostClient, type HostLauncher } from '../../src/terminal/host-client'
import { processStart } from '../../src/terminal-host/identity'
import {
  clientControlSchema,
  encodeControl,
  encodeOutput,
  ensureSocketDirectory,
  ensureToken,
  FrameDecoder,
  hostPaths,
  PROTOCOL_VERSION,
  type ClientControl,
  type HostControl,
  type HostSessionInfo,
} from '../../src/terminal-host/protocol'

type FakeSession = {
  readonly key: string
  readonly session: number
  readonly pid: number
  output: Uint8Array
  exit: { exitCode: number; signal: string | null } | null
  readonly subscribers: Set<net.Socket>
}

const encoder = new TextEncoder()

/**
 * An in-process stand-in for the terminal host: it speaks the real protocol over the real socket
 * path, so a real `TerminalHostClient` talks to it, and it needs no native PTY.
 */
export async function createFakeTerminalHost() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-fake-host-'))
  const stateRoot = path.join(root, 'home')
  const env = { ...process.env, XDG_RUNTIME_DIR: path.join(root, 'run') }
  const paths = hostPaths(stateRoot, env)
  ensureSocketDirectory(paths)
  ensureToken(paths)
  await writeFile(
    paths.manifest,
    JSON.stringify({ hostPid: process.pid, processStart: processStart(process.pid) }),
  )
  const sessions = new Map<number, FakeSession>()
  const sockets = new Set<net.Socket>()
  const received: ClientControl[] = []
  // Operations the host reads but never answers.
  const unanswered = new Set<ClientControl['type']>()
  // Operations the host answers with an error.
  const refused = new Set<ClientControl['type']>()
  const clients: TerminalHostClient[] = []
  let nextSession = 1

  const send = (socket: net.Socket, control: HostControl) => {
    if (!socket.destroyed) socket.write(encodeControl(control))
  }
  const info = (session: FakeSession): HostSessionInfo => ({
    key: session.key,
    session: session.session,
    pid: session.pid,
    startedAt: new Date(0).toISOString(),
    offset: session.output.byteLength,
    exited: session.exit !== null,
  })
  const exited = (socket: net.Socket, session: FakeSession) => {
    if (!session.exit) return
    send(socket, { type: 'exited', session: session.session, ...session.exit })
    sessions.delete(session.session)
  }
  const attach = (socket: net.Socket, control: Extract<ClientControl, { type: 'attach' }>) => {
    const session = [...sessions.values()].find(
      (candidate) =>
        candidate.key === control.key &&
        (control.session === undefined || candidate.session === control.session),
    )
    if (!session) {
      send(socket, {
        type: 'error',
        request: control.request,
        code: 'unknown-key',
        message: 'No terminal with that key.',
      })
      return
    }
    const from = Math.min(control.from, session.output.byteLength)
    send(socket, {
      type: 'attached',
      replayedBytes: session.output.byteLength - from,
      gapBytes: 0,
      request: control.request,
      key: session.key,
      session: session.session,
      pid: session.pid,
    })
    session.subscribers.add(socket)
    if (from < session.output.byteLength)
      socket.write(encodeOutput(session.session, from, session.output.subarray(from)))
    exited(socket, session)
  }
  const command = (socket: net.Socket, control: ClientControl) => {
    received.push(control)
    if (unanswered.has(control.type)) return
    if (refused.has(control.type) && 'request' in control)
      return send(socket, {
        type: 'error',
        request: control.request,
        code: 'refused',
        message: 'Refused by the test.',
      })
    if (control.type === 'hello')
      return send(socket, {
        type: 'hello',
        version: PROTOCOL_VERSION,
        capabilities: [],
        pid: process.pid,
        cgroup: null,
        startedAt: new Date(0).toISOString(),
        build: { release: null, commit: null, dirtyFiles: null },
      })
    if (control.type === 'list')
      return send(socket, {
        type: 'list',
        request: control.request,
        sessions: [...sessions.values()].map(info),
      })
    if (control.type === 'attach') return attach(socket, control)
    if (control.type === 'kill') return kill(control.session)
    if (control.type !== 'spawn') return
    const session = add(control.key)
    session.subscribers.add(socket)
    send(socket, {
      type: 'spawned',
      request: control.request,
      key: session.key,
      session: session.session,
      pid: session.pid,
    })
  }
  const add = (key: string, output = '') => {
    const session: FakeSession = {
      key,
      session: nextSession++,
      pid: 90_000 + nextSession,
      output: encoder.encode(output),
      exit: null,
      subscribers: new Set(),
    }
    sessions.set(session.session, session)
    return session
  }
  const write = (id: number, text: string) => {
    const session = sessions.get(id)
    if (!session) return
    const bytes = encoder.encode(text)
    const offset = session.output.byteLength
    const joined = new Uint8Array(offset + bytes.byteLength)
    joined.set(session.output)
    joined.set(bytes, offset)
    session.output = joined
    for (const socket of session.subscribers) {
      if (!socket.destroyed) socket.write(encodeOutput(id, offset, bytes))
    }
  }
  const exit = (id: number, exitCode = 0) => {
    const session = sessions.get(id)
    if (!session || session.exit) return
    session.exit = { exitCode, signal: null }
    const live = [...session.subscribers].filter((socket) => !socket.destroyed)
    for (const socket of live) exited(socket, session)
  }
  const kill = (id: number) => {
    const session = sessions.get(id)
    if (session?.exit) return void sessions.delete(id)
    exit(id, 129)
  }

  const server = net.createServer((socket) => {
    sockets.add(socket)
    const decoder = new FrameDecoder()
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.type !== 'control') continue
        const parsed = v.safeParse(clientControlSchema, frame.message)
        if (parsed.success) command(socket, parsed.output)
      }
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      for (const session of sessions.values()) session.subscribers.delete(socket)
    })
  })
  await new Promise<void>((resolve) => server.listen(paths.socket, resolve))

  // The host is already listening; a launch means the socket stopped answering.
  const refuseLaunch: HostLauncher = () => {
    throw new TypeError('The fake terminal host cannot be relaunched')
  }

  return {
    stateRoot,
    paths,
    sessions,
    received,
    unanswered,
    refused,
    add,
    write,
    exit,
    connect(options: { requestTimeoutMs?: number } = {}) {
      const client = new TerminalHostClient({ stateRoot, env, launch: refuseLaunch, ...options })
      clients.push(client)
      return client
    },
    /** Drops every client connection while the host itself keeps running. */
    drop() {
      for (const socket of sockets) socket.destroy()
    },
    /** Stops answering: the socket is gone, as after a host crash. */
    async stop() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    async close() {
      for (const client of clients) client.close()
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    },
  }
}
