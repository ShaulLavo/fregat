import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { ProviderProcessLifetime } from '../process-lifetime'
import { openCodeErrors } from './opencode-errors'

export class OpenCodeServer {
  private lifetime: ProviderProcessLifetime | null = null
  private starting: Promise<string> | null = null
  private url: string | null = null
  private groupId: number | null = null
  private readonly controller = new AbortController()

  private readonly options: { binaryPath?: string; env: NodeJS.ProcessEnv; serverUrl?: string }

  constructor(options: { binaryPath?: string; env: NodeJS.ProcessEnv; serverUrl?: string }) {
    this.options = options
  }

  currentUrl() {
    return this.options.serverUrl ?? this.url
  }

  async start(cwd: string, signal?: AbortSignal) {
    if (this.options.serverUrl) return this.options.serverUrl
    if (this.url && this.lifetime?.isAlive()) return this.url
    if (this.starting) return this.starting
    const startupSignal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
    this.starting = this.spawnServer(cwd, startupSignal)
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  async close() {
    this.controller.abort()
    await this.starting?.catch(() => undefined)
    await this.closeProcess()
    this.lifetime = null
    this.url = null
  }

  private async spawnServer(cwd: string, signal: AbortSignal): Promise<string> {
    // Native port zero prefers 4096. A discovery/spawn race fails this owned launch.
    const port = await freeLoopbackPort()
    if (signal.aborted)
      throw openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'startup-cancelled' } })
    const expectedUrl = `http://127.0.0.1:${port}`
    const child = spawn(
      this.options.binaryPath ?? 'opencode',
      ['serve', '--hostname=127.0.0.1', `--port=${port}`],
      {
        cwd,
        env: this.options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    )
    const lifetime = new ProviderProcessLifetime(child)
    this.lifetime = lifetime
    this.groupId = process.platform === 'win32' ? null : (child.pid ?? null)
    let output = ''
    const ready = Promise.withResolvers<string>()
    const cancel = () =>
      ready.reject(
        openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'startup-cancelled' } }),
      )
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const observe = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-65_536)
      // SDKv2 releases changed the prefix, but kept the loopback listening URL.
      const match = output.match(/server listening on[ 	]+(\S+)[ 	]*\r?\n/i)
      if (!match) return
      if (!lifetime.isAlive() || (match[1] !== expectedUrl && match[1] !== `${expectedUrl}/`)) {
        ready.reject(
          openCodeErrors.OPENCODE_REQUEST_FAILED({
            internal: { operation: 'startup-address', requestedPort: port },
          }),
        )
        return
      }
      ready.resolve(expectedUrl)
    }
    child.stdout.on('data', observe)
    child.stderr.on('data', observe)
    child.once('error', () =>
      ready.reject(openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'spawn' } })),
    )
    child.once('exit', (code, signal) =>
      ready.reject(
        openCodeErrors.OPENCODE_REQUEST_FAILED({
          internal: { operation: 'startup', exitCode: code, signal },
        }),
      ),
    )
    const timeout = setTimeout(
      () =>
        ready.reject(
          openCodeErrors.OPENCODE_REQUEST_FAILED({
            internal: { operation: 'startup', timeoutMs: 30_000 },
          }),
        ),
      30_000,
    )
    try {
      const url = await ready.promise
      if (!lifetime.isAlive())
        throw openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'startup-exit' } })
      this.url = url
      return url
    } catch (error) {
      await this.closeProcess()
      throw error
    } finally {
      clearTimeout(timeout)
      child.stdout.off('data', observe)
      child.stderr.off('data', observe)
      signal.removeEventListener('abort', cancel)
    }
  }

  private async closeProcess() {
    const groupId = this.groupId
    this.groupId = null
    if (groupId && signalOwnedGroup(groupId, 'SIGTERM')) {
      await delay(1_000)
      signalOwnedGroup(groupId, 'SIGKILL')
    }
    await this.lifetime?.close()
  }
}

function signalOwnedGroup(groupId: number, signal: NodeJS.Signals) {
  try {
    process.kill(-groupId, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw openCodeErrors.OPENCODE_REQUEST_FAILED({
      internal: { operation: 'group-signal', signal },
    })
  }
}

async function freeLoopbackPort(): Promise<number> {
  const listener = createServer()
  const ready = Promise.withResolvers<number>()
  listener.once('error', () =>
    ready.reject(
      openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'port-discovery' } }),
    ),
  )
  listener.listen({ host: '127.0.0.1', port: 0 }, () => {
    const address = listener.address()
    if (!address || typeof address === 'string') {
      listener.close()
      ready.reject(
        openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'port-discovery' } }),
      )
      return
    }
    listener.close((error) => {
      if (error) {
        ready.reject(
          openCodeErrors.OPENCODE_REQUEST_FAILED({ internal: { operation: 'port-release' } }),
        )
        return
      }
      ready.resolve(address.port)
    })
  })
  return ready.promise
}
