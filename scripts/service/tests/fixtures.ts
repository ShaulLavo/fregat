import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ensureIdentityKey,
  IDENTITY_PROOF_HEADER,
  identityProof,
} from '../../../apps/server/src/system/identity-key'
import { realServiceHost, type ServiceHost } from '../host'

export const MACHINE_ID = '0123456789abcdef0123456789abcdef'
export const ENVIRONMENT_ID = '6f1d1c2e-3b9a-4f0e-9d7a-2b8c5e4f1a90'

const cleanups: Array<() => unknown> = []

export async function cleanup() {
  for (const step of cleanups.splice(0).reverse()) await step()
}

export function scratch() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'platform-service-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

export async function freePort() {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (typeof address !== 'object' || !address) throw new Error('no free port')
  return address.port
}

/** A release root with the one file setup requires before registering. */
export function releaseRoot(root: string) {
  const directory = path.join(root, 'releases')
  mkdirSync(path.join(directory, 'current', 'server'), { recursive: true })
  Bun.write(path.join(directory, 'current', 'server', 'index.js'), '')
  return directory
}

/** A listener answering the identity route the way a real server for `stateHome` does. */
export function fregatServer(options: {
  port: number
  stateHome: string
  /** The state home whose key signs the proof; another one forges it. */
  keyHome?: string
  environmentId?: string
  /** Runs as each request arrives, before the answer. */
  onRequest?: () => void
  identityError?: { code: string; message: string; why?: string; fix?: string }
}) {
  const key = ensureIdentityKey(options.keyHome ?? options.stateHome)
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port,
    fetch(request) {
      options.onRequest?.()
      const url = new URL(request.url)
      const challenge = url.searchParams.get('challenge') ?? ''
      if (options.identityError)
        return Response.json(
          { error: options.identityError },
          {
            status: 500,
            headers: { [IDENTITY_PROOF_HEADER]: identityProof(key, challenge) },
          },
        )
      return Response.json(
        {
          product: 'fregat',
          protocolVersion: 1,
          machineId: MACHINE_ID,
          environmentId: options.environmentId ?? ENVIRONMENT_ID,
          stateHome: options.stateHome,
          address: `http://127.0.0.1:${options.port}`,
          webBase: '/',
          service: { kind: 'systemd-socket', registrationId: 'fregat-server.socket' },
        },
        { headers: { [IDENTITY_PROOF_HEADER]: identityProof(key, challenge) } },
      )
    },
  })
  cleanups.push(() => server.stop(true))
  return server
}

export function otherProgram(port: number) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => new Response('<title>Not Fregat</title>', { status: 404 }),
  })
  cleanups.push(() => server.stop(true))
  return server
}

/** Accepts connections and never answers, like a server stuck in startup. */
export async function silentListener(port: number) {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => sockets.add(socket))
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
}

/** The real file operations under a scratch home; commands are recorded and answered by `onRun`. */
export function recordingHost(
  root: string,
  platform: NodeJS.Platform,
  onRun: (argv: readonly string[]) => { code: number; stdout?: string } | void = () => {},
) {
  const commands: string[][] = []
  const real = realServiceHost()
  const host: ServiceHost = {
    ...real,
    platform,
    uid: 501,
    home: path.join(root, 'home'),
    env: { XDG_CONFIG_HOME: path.join(root, 'config') },
    bun: '/opt/bun/bin/bun',
    run: async (argv) => {
      commands.push([...argv])
      const answer = onRun(argv)
      return { code: answer?.code ?? 0, stdout: answer?.stdout ?? '', stderr: '' }
    },
  }
  return { host, commands }
}
