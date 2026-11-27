import { ManagedPty, spawnFailedError } from './utils/managed-pty'
import { validateDimensions, validateOptions } from './utils/options'
import { operationError } from './utils/structured-errors'
import type { Pty, SpawnPtyOptions } from './utils/types'

export interface PipePtyHandle extends Pty {
  signal(signal: NodeJS.Signals): void
}

function supportsProcessGroupSignals() {
  const arch: string = process.arch
  return process.platform !== 'win32' && arch !== 'wasm32'
}

/**
 * Spawns a child process connected through stdio pipes instead of a kernel PTY.
 * Used when `Bun.Terminal` or native PTYs are unavailable (such as under WASI).
 */
export function spawnPipePty(options: SpawnPtyOptions): PipePtyHandle {
  validateOptions(options)
  return new PipePty(options)
}

class PipePty extends ManagedPty implements PipePtyHandle {
  readonly #stdin: Bun.FileSink
  readonly #useProcessGroup: boolean

  constructor(options: SpawnPtyOptions) {
    super()
    this.#useProcessGroup = supportsProcessGroupSignals()
    const env = options.env ?? process.env
    let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
    try {
      child = Bun.spawn(Array.from(options.command), {
        cwd: options.cwd,
        env: { ...env, TERM: env.TERM ?? 'xterm-256color' },
        detached: this.#useProcessGroup,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (cause) {
      throw spawnFailedError(cause, options)
    }

    this.#stdin = child.stdin
    void Promise.all([
      this.#drain(child.stdout, options.onData),
      this.#drain(child.stderr, options.onData),
    ]).finally(() => this.endStream())
    this.attachChild(child)
  }

  write(data: string | Uint8Array) {
    if (this.ended) return
    try {
      this.#stdin.write(data)
      void this.#stdin.flush()
    } catch (cause) {
      throw operationError('write', cause)
    }
  }

  resize(cols: number, rows: number) {
    validateDimensions(cols, rows)
  }

  signal(signal: NodeJS.Signals) {
    this.sendSignal(signal)
  }

  protected override onKillStart() {
    this.closeTransport()
  }

  protected override deliverSignal(
    child: { readonly pid: number; kill(signal?: NodeJS.Signals): void },
    signal: NodeJS.Signals,
  ) {
    if (this.#useProcessGroup && child.pid > 0) {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        // Fall back to signaling the direct child when process-group signaling is unavailable.
      }
    }
    child.kill(signal)
  }

  protected closeTransport() {
    try {
      void this.#stdin.end()
    } catch {
      // Stdin may already be closed.
    }
  }

  async #drain(stream: ReadableStream<Uint8Array>, onData: SpawnPtyOptions['onData']) {
    const reader = stream.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (value && value.byteLength > 0) this.deliver(onData, value)
      }
    } catch {
      // Stream teardown after kill is expected.
    } finally {
      reader.releaseLock()
    }
  }
}
