import { dlopen, FFIType, ptr, read, type Pointer } from 'bun:ffi'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isLoopbackAddress } from './locality'
import { systemErrors } from './structured-errors'

/** systemd hands activated sockets from fd 3 (`SD_LISTEN_FDS_START`). */
const SYSTEMD_FIRST_FD = 3

export type ActivatedSocket = { fd: number; manager: 'systemd' | 'launchd' }

/**
 * The listening socket a service manager opened for this process, or null when it was started by
 * hand. systemd names it through LISTEN_PID/LISTEN_FDS; launchd through the `--launchd-socket`
 * argument naming the plist's `Sockets` entry.
 */
export function activatedSocket(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): ActivatedSocket | null {
  const launchdName = argv.find((arg) => arg.startsWith('--launchd-socket='))?.split('=')[1]
  if (launchdName) return { fd: launchdSocket(launchdName), manager: 'launchd' }
  if (env.LISTEN_PID !== String(process.pid)) return null
  const count = env.LISTEN_FDS
  // Children this server spawns must not think the socket is theirs.
  delete env.LISTEN_PID
  delete env.LISTEN_FDS
  delete env.LISTEN_FDNAMES
  if (count !== '1')
    throw systemErrors.ACTIVATION_INVALID({ internal: { manager: 'systemd', count } })
  return { fd: SYSTEMD_FIRST_FD, manager: 'systemd' }
}

function launchdSocket(name: string) {
  if (process.platform !== 'darwin')
    throw systemErrors.ACTIVATION_INVALID({
      internal: { manager: 'launchd', platform: process.platform },
    })
  const { symbols } = dlopen('/usr/lib/libSystem.B.dylib', {
    launch_activate_socket: {
      args: [FFIType.cstring, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    free: { args: [FFIType.ptr], returns: FFIType.void },
  })
  const fds = new BigUint64Array(1)
  const count = new BigUint64Array(1)
  const error = symbols.launch_activate_socket(ptr(Buffer.from(`${name}\0`)), ptr(fds), ptr(count))
  if (error !== 0 || count[0] !== 1n)
    throw systemErrors.ACTIVATION_INVALID({
      internal: { manager: 'launchd', error, count: Number(count[0]) },
    })
  // launchd returns a malloc'd int array the caller frees.
  const array = Number(fds[0]) as Pointer
  const fd = read.i32(array, 0)
  symbols.free(array)
  return fd
}

export type Relay = { close: () => Promise<void> }

/** Where the app listens behind the relay: an owner-only socket in an owner-only directory. */
export type PrivateSocket = { directory: string; socketPath: string }

/**
 * Bun's HTTP server cannot adopt an inherited listener, but node:net can. Each loopback
 * connection is piped byte for byte to the app's private Unix socket, so WebSocket upgrades,
 * SSE, uploads and half-close pass through unchanged, with stream backpressure.
 */
export async function startRelay(
  activated: ActivatedSocket,
  expected: { hostname: string; port: number },
  upstream: PrivateSocket,
): Promise<Relay> {
  const { socketPath } = upstream
  const connections = new Set<net.Socket>()
  const relay = net.createServer({ allowHalfOpen: true }, (client) => {
    if (!isLoopbackAddress(client.remoteAddress ?? '')) {
      client.destroy()
      return
    }
    const server = net.connect({ path: socketPath, allowHalfOpen: true })
    connections.add(client)
    const close = () => {
      client.destroy()
      server.destroy()
      connections.delete(client)
    }
    client.on('error', close).on('close', close)
    server.on('error', close).on('close', close)
    client.pipe(server)
    server.pipe(client)
  })
  await new Promise<void>((resolve, reject) => {
    relay.once('error', reject)
    relay.listen({ fd: activated.fd }, () => {
      relay.off('error', reject)
      resolve()
    })
  })
  const address = relay.address()
  if (
    typeof address !== 'object' ||
    address === null ||
    address.port !== expected.port ||
    address.address !== expected.hostname
  ) {
    relay.close()
    throw systemErrors.ACTIVATION_INVALID({
      internal: { manager: activated.manager, expected, received: address },
    })
  }
  return {
    close: async () => {
      // The service manager keeps the listening socket; this only stops accepting here.
      await new Promise<void>((resolve) => relay.close(() => resolve()))
      for (const connection of connections) connection.destroy()
      rmSync(upstream.directory, { recursive: true, force: true })
    },
  }
}

/** A fresh owner-only directory per activation; the socket is never a network address. */
export function privateSocket(env: NodeJS.ProcessEnv = process.env): PrivateSocket {
  const base = env.XDG_RUNTIME_DIR || tmpdir()
  const directory = mkdtempSync(path.join(base, 'fregat-server-'))
  chmodSync(directory, 0o700)
  return { directory, socketPath: path.join(directory, 'server.sock') }
}

/** Call once the app listens on the socket: Bun creates it with the process umask. */
export function restrictPrivateSocket(socket: PrivateSocket) {
  chmodSync(socket.socketPath, 0o600)
}
