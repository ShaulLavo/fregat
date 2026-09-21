import { validateDimensions, validateOptions } from './utils/options'
import { operationError, ptyErrors } from './utils/structured-errors'
import type { Pty, PtyExit, SpawnPtyOptions } from './utils/types'

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

class NativePty implements Pty {
  readonly #child
  readonly #terminal: Bun.Terminal
  readonly #completion = Promise.withResolvers<PtyExit>()
  readonly exited = this.#completion.promise
  #result: PtyExit | null = null
  #streamEnded = false
  #completed = false
  #killTimer: ReturnType<typeof setTimeout> | undefined
  #failure: Error | undefined

  constructor(options: SpawnPtyOptions) {
    const env = options.env ?? process.env
    try {
      // Give Bun's mutable argv API its own array, preserving the caller's command.
      this.#child = Bun.spawn([...options.command], {
        cwd: options.cwd,
        env: { ...env, TERM: env.TERM ?? 'xterm-256color' },
        terminal: {
          cols: options.cols ?? 80,
          rows: options.rows ?? 24,
          data: (_terminal, bytes) => this.#deliver(options.onData, bytes),
          exit: () => this.#endStream(),
        },
      })
    } catch (cause) {
      throw ptyErrors.SPAWN_FAILED({
        ...(cause instanceof Error ? { cause } : {}),
        internal: {
          ...(cause instanceof Error ? {} : { cause }),
          command: options.command,
          cols: options.cols ?? 80,
          rows: options.rows ?? 24,
        },
      })
    }

    const terminal = this.#child.terminal
    if (!terminal) {
      this.#child.kill('SIGKILL')
      throw ptyErrors.UNSUPPORTED_RUNTIME({
        internal: { reason: 'no-terminal-on-child', bunVersion: Bun.version },
      })
    }
    this.#terminal = terminal
    void this.#child.exited.then(
      (exitCode) => this.#endProcess(exitCode),
      (cause: unknown) => this.#failProcess(cause),
    )
  }

  get pid() {
    return this.#child.pid
  }

  write(data: string | Uint8Array) {
    if (this.#streamEnded || this.#completed) return
    try {
      this.#terminal.write(data)
    } catch (cause) {
      throw operationError('write', cause)
    }
  }

  resize(cols: number, rows: number) {
    validateDimensions(cols, rows)
    if (this.#streamEnded || this.#completed) return
    try {
      this.#terminal.resize(cols, rows)
    } catch (cause) {
      throw operationError('resize', cause)
    }
  }

  kill(signal: NodeJS.Signals = 'SIGHUP') {
    if (this.#completed) return
    if (this.#killTimer) {
      if (signal === 'SIGKILL') this.#signal(signal)
      return
    }
    this.#signal(signal)
    this.#killTimer = setTimeout(() => this.#forceClose(), 250)
  }

  async [Symbol.asyncDispose]() {
    this.kill()
    await this.exited
  }

  #deliver(onData: SpawnPtyOptions['onData'], bytes: Uint8Array) {
    if (this.#failure || this.#completed) return
    try {
      onData(bytes)
    } catch (cause) {
      this.#failure = operationError('output callback', cause)
      this.kill()
    }
  }

  #signal(signal: NodeJS.Signals) {
    if (this.#result) return
    try {
      this.#child.kill(signal)
    } catch (cause) {
      this.#failure ??= operationError('signal', cause)
    }
  }

  #forceClose() {
    if (this.#completed) return
    this.#signal('SIGKILL')
    this.#terminal.close()
    this.#endStream()
  }

  #endStream() {
    this.#streamEnded = true
    this.#finish()
  }

  #endProcess(exitCode: number) {
    this.#result = { exitCode, signal: this.#child.signalCode }
    this.#finish()
  }

  #failProcess(cause: unknown) {
    this.#failure ??= operationError('wait for exit', cause)
    this.#signal('SIGKILL')
    this.#result = { exitCode: 1, signal: this.#child.signalCode }
    this.#forceClose()
  }

  #finish() {
    if (this.#completed || !this.#streamEnded || !this.#result) return
    this.#completed = true
    clearTimeout(this.#killTimer)
    this.#terminal.close()
    if (this.#failure) {
      this.#completion.reject(this.#failure)
      return
    }
    this.#completion.resolve(this.#result)
  }
}
