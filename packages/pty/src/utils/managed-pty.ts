import { operationError, ptyErrors } from './structured-errors'
import type { Pty, PtyExit, SpawnPtyOptions } from './types'

export type ManagedSubprocess = {
  readonly pid: number
  readonly signalCode: NodeJS.Signals | null
  readonly exited: Promise<number>
  kill(signal?: NodeJS.Signals): void
}

export function spawnFailedError(cause: unknown, options: SpawnPtyOptions) {
  return ptyErrors.SPAWN_FAILED({
    ...(cause instanceof Error ? { cause } : {}),
    internal: {
      ...(cause instanceof Error ? {} : { cause }),
      command: options.command,
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
    },
  })
}

export abstract class ManagedPty implements Pty {
  #child: ManagedSubprocess | null = null
  readonly #completion = Promise.withResolvers<PtyExit>()
  readonly exited = this.#completion.promise
  #result: PtyExit | null = null
  #streamEnded = false
  #completed = false
  #killTimer: ReturnType<typeof setTimeout> | undefined
  #failure: Error | undefined

  protected attachChild(child: ManagedSubprocess) {
    this.#child = child
    void child.exited.then(
      (exitCode) => this.#endProcess(exitCode),
      (cause: unknown) => this.#failProcess(cause),
    )
  }

  get pid() {
    return this.#child?.pid ?? 0
  }

  protected get ended() {
    return this.#streamEnded || this.#completed
  }

  abstract write(data: string | Uint8Array): void
  abstract resize(cols: number, rows: number): void
  protected abstract closeTransport(): void

  protected onKillStart() {
    // Subclasses override to close stdin or auxiliary streams before signalling.
  }

  kill(signal: NodeJS.Signals = 'SIGHUP') {
    if (this.#completed) return
    if (this.#killTimer) {
      if (signal === 'SIGKILL') this.#signal(signal)
      return
    }
    this.onKillStart()
    this.#signal(signal)
    this.#killTimer = setTimeout(() => this.#forceClose(), 250)
  }

  async [Symbol.asyncDispose]() {
    this.kill()
    await this.exited
  }

  protected deliver(onData: SpawnPtyOptions['onData'], bytes: Uint8Array) {
    if (this.#failure || this.#completed) return
    try {
      onData(bytes)
    } catch (cause) {
      this.#failure = operationError('output callback', cause)
      this.kill()
    }
  }

  protected endStream() {
    this.#streamEnded = true
    this.#finish()
  }

  #signal(signal: NodeJS.Signals) {
    if (this.#result || !this.#child) return
    try {
      this.deliverSignal(this.#child, signal)
    } catch (cause) {
      this.#failure ??= operationError('signal', cause)
    }
  }

  protected deliverSignal(child: ManagedSubprocess, signal: NodeJS.Signals) {
    child.kill(signal)
  }

  #forceClose() {
    if (this.#completed) return
    this.#signal('SIGKILL')
    this.closeTransport()
    this.endStream()
  }

  #endProcess(exitCode: number) {
    this.#result = { exitCode, signal: this.#child?.signalCode ?? null }
    this.#finish()
  }

  #failProcess(cause: unknown) {
    this.#failure ??= operationError('wait for exit', cause)
    this.#signal('SIGKILL')
    this.#result = { exitCode: 1, signal: this.#child?.signalCode ?? null }
    this.#forceClose()
  }

  #finish() {
    if (this.#completed || !this.#streamEnded || !this.#result) return
    this.#completed = true
    clearTimeout(this.#killTimer)
    this.closeTransport()
    if (this.#failure) {
      this.#completion.reject(this.#failure)
      return
    }
    this.#completion.resolve(this.#result)
  }
}
