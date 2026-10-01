import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { ProviderProcessLifetime } from '../process-lifetime'
import { openCodeErrors } from './opencode-errors'

export class OpenCodeServer {
  private lifetime: ProviderProcessLifetime | null = null
  private starting: Promise<string> | null = null
  private url: string | null = null

  private readonly options: { binaryPath?: string; env: NodeJS.ProcessEnv; serverUrl?: string }

  constructor(options: { binaryPath?: string; env: NodeJS.ProcessEnv; serverUrl?: string }) {
    this.options = options
  }

  currentUrl() {
    return this.options.serverUrl ?? this.url
  }

  async start(cwd: string) {
    if (this.options.serverUrl) return this.options.serverUrl
    if (this.url && this.lifetime?.isAlive()) return this.url
    if (this.starting) return this.starting
    this.starting = this.spawnServer(cwd)
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  async close() {
    await this.starting?.catch(() => undefined)
    await this.lifetime?.close()
    this.lifetime = null
    this.url = null
  }

  private async spawnServer(cwd: string): Promise<string> {
    // Native port zero prefers 4096. A discovery/spawn race fails this owned launch.
    const port = await freeLoopbackPort()
    const expectedUrl = `http://127.0.0.1:${port}`
    const child = spawn(
      this.options.binaryPath ?? 'opencode',
      ['serve', '--hostname=127.0.0.1', `--port=${port}`],
      {
        cwd,
        env: this.options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const lifetime = new ProviderProcessLifetime(child)
    this.lifetime = lifetime
    let output = ''
    const ready = Promise.withResolvers<string>()
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
      await lifetime.close()
      throw error
    } finally {
      clearTimeout(timeout)
      child.stdout.off('data', observe)
      child.stderr.off('data', observe)
    }
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
