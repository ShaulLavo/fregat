import { ManagedPty, spawnFailedError } from './utils/managed-pty'
import { validateDimensions, validateOptions } from './utils/options'
import { operationError, ptyErrors } from './utils/structured-errors'
import type { Pty, SpawnPtyOptions } from './utils/types'

export function hasNativePty() {
  const arch: string = process.arch
  return (
    typeof Bun !== 'undefined' &&
    typeof Bun.Terminal === 'function' &&
    Bun.semver.satisfies(Bun.version, '>=1.3.14') &&
    (process.platform === 'linux' || process.platform === 'darwin') &&
    arch !== 'wasm32'
  )
}

export function spawnPty(options: SpawnPtyOptions): Pty {
  if (typeof Bun === 'undefined' || typeof Bun.Terminal !== 'function') {
    throw ptyErrors.UNSUPPORTED_RUNTIME({
      internal: { reason: 'no-bun-terminal', runtime: typeof Bun === 'undefined' ? 'node' : 'bun' },
    })
  }
  if (!Bun.semver.satisfies(Bun.version, '>=1.3.14')) {
    throw ptyErrors.UNSUPPORTED_RUNTIME({
      internal: { reason: 'bun-version', version: Bun.version, required: '>=1.3.14' },
    })
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw ptyErrors.UNSUPPORTED_RUNTIME({
      internal: { reason: 'platform', platform: process.platform },
    })
  }
  validateOptions(options)
  return new NativePty(options)
}

class NativePty extends ManagedPty {
  readonly #terminal: Bun.Terminal

  constructor(options: SpawnPtyOptions) {
    super()
    const env = options.env ?? process.env
    let child: Bun.Subprocess
    try {
      // Give Bun's mutable argv API its own array, preserving the caller's command.
      child = Bun.spawn(Array.from(options.command), {
        cwd: options.cwd,
        env: { ...env, TERM: env.TERM ?? 'xterm-256color' },
        terminal: {
          cols: options.cols ?? 80,
          rows: options.rows ?? 24,
          data: (_terminal, bytes) => this.deliver(options.onData, bytes),
          exit: () => this.endStream(),
        },
      })
    } catch (cause) {
      throw spawnFailedError(cause, options)
    }

    const terminal = child.terminal
    if (!terminal) {
      child.kill('SIGKILL')
      throw ptyErrors.UNSUPPORTED_RUNTIME({
        internal: { reason: 'no-terminal-on-child', bunVersion: Bun.version },
      })
    }

    this.#terminal = terminal
    this.attachChild(child)
  }

  write(data: string | Uint8Array) {
    if (this.ended) return
    try {
      this.#terminal.write(data)
    } catch (cause) {
      throw operationError('write', cause)
    }
  }

  resize(cols: number, rows: number) {
    validateDimensions(cols, rows)
    if (this.ended) return
    try {
      this.#terminal.resize(cols, rows)
    } catch (cause) {
      throw operationError('resize', cause)
    }
  }

  protected closeTransport() {
    this.#terminal.close()
  }
}
