import net from 'node:net'
import { createSshError, type SshCatalogStep } from './structured-errors'
import { parseDescriptor, remoteFailure } from './records'
import { shellQuote } from '../utils/shell'

export type SshChild = Pick<
  Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  'exited' | 'exitCode' | 'signalCode' | 'kill' | 'stdout' | 'stderr'
>
export type SshSpawner = (command: string[]) => SshChild

export type ForwardOptions = {
  spawn: SshSpawner
  target: string
  localPort: number
  remotePort: number
}

export type SshForward = {
  readonly child: SshChild
  close(): Promise<void>
}

export const spawnSsh: SshSpawner = (command) =>
  Bun.spawn({
    cmd: command,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

const sshOptions = [
  'ssh',
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ConnectTimeout=10',
]

function sshCommand(target: string, script: string) {
  return [...sshOptions, '--', target, 'sh', '-c', shellQuote(script)]
}

export async function runSshCommand(options: {
  spawn: SshSpawner
  target: string
  script: string
  step: SshCatalogStep
  signal?: AbortSignal
}) {
  options.signal?.throwIfAborted()
  const child = options.spawn(sshCommand(options.target, options.script))
  const timeout = setTimeout(() => child.kill('SIGKILL'), 150_000)
  const abort = () => child.kill('SIGKILL')
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    options.signal?.throwIfAborted()
    if (exitCode !== 0) throw remoteFailure(options.step, stderr, exitCode)
    return stdout
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}

export async function reserveForwardPort(retainedPort?: number) {
  if (retainedPort !== undefined) {
    if (await isPortAvailable(retainedPort)) return retainedPort
    throw createSshError('forward', `Local port ${retainedPort} is occupied.`)
  }
  const port = await ephemeralPort()
  if (!(await isPortAvailable(port)))
    throw createSshError(
      'forward',
      `Local port ${port} became occupied while preparing the forward.`,
    )
  return port
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ exclusive: true, host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

function ephemeralPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () =>
      finishPortProbe(server, resolve, reject),
    )
  })
}

function finishPortProbe(
  server: net.Server,
  resolve: (port: number) => void,
  reject: (error: unknown) => void,
) {
  const address = server.address()
  if (address === null || typeof address === 'string')
    return server.close(() => reject(createSshError('forward')))
  server.close((error) => (error ? reject(error) : resolve(address.port)))
}

export function forwardCommand(options: ForwardOptions, session: readonly string[] = []) {
  return [
    ...sshOptions,
    session.length === 0 ? '-N' : '-T',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
    '-L',
    `127.0.0.1:${options.localPort}:127.0.0.1:${options.remotePort}`,
    '--',
    options.target,
    ...session,
  ]
}

export async function openForward(options: ForwardOptions): Promise<SshForward> {
  const child = options.spawn(forwardCommand(options))
  return { child, close: () => closeForward(child) }
}

export async function waitForDescriptor(options: {
  child: SshChild
  origin: string
  webOrigin: string
  signal: AbortSignal
  fetcher: typeof fetch
}) {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    options.signal.throwIfAborted()
    if (options.child.exitCode !== null || options.child.signalCode !== null)
      throw createSshError('forward', `SSH exited with status ${options.child.exitCode}.`)
    const descriptor = await probeDescriptor(options)
    if (descriptor) return descriptor
    await Bun.sleep(200)
  }
  throw createSshError('readiness')
}

export async function probeDescriptor(options: {
  origin: string
  webOrigin: string
  signal: AbortSignal
  fetcher: typeof fetch
}) {
  try {
    const response = await options.fetcher(`${options.origin}/health`, {
      headers: { Origin: options.webOrigin },
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(1000)]),
    })
    if (response.status === 401 || response.status === 403)
      throw createSshError(
        'readiness',
        `Origin ${options.webOrigin} was refused (${response.status}).`,
      )
    if (!response.ok) return null
    return await parseDescriptor(await response.json())
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('machines.')
    )
      throw error
    return null
  }
}

export async function closeForward(child: SshChild) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 2000)
  try {
    await child.exited
  } finally {
    clearTimeout(timeout)
  }
}
