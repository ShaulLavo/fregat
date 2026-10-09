import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { descriptorFor } from '@workspace/contracts'
import { defineErrorCatalog } from 'evlog'

export const nativeErrors = defineErrorCatalog('desktop.webview', {
  PICKER_TIMEOUT: {
    status: 408,
    message: 'The folder chooser closed after its time limit.',
    why: 'The folder chooser did not receive a selection before the allowed interval ended.',
    fix: 'Open the folder chooser again and select a folder before it closes.',
  },
  PICKER_REFUSED: {
    status: 400,
    message: 'The folder chooser request is not valid.',
    why: 'The desktop app could not read the folder chooser request this window sent.',
    fix: 'Reload the window, then open the folder again.',
  },
  HOST_FAILED: {
    status: 500,
    message: 'The desktop native helper stopped.',
    why: 'The native helper could not start or complete its window protocol.',
    fix: 'Run desktop build:native and check the desktop logs before opening the window again.',
  },
})
export type NativeBudget = { dialogMs: number; stopGraceMs: number }
export function nativeBudget(values: Partial<Record<string, unknown>> = {}): NativeBudget {
  const milliseconds = (
    id: 'window.nativeDialogTimeoutSeconds' | 'window.nativeHostStopGraceSeconds',
  ) => {
    const value = values[id]
    return (
      (typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : descriptorFor(id).default) * 1000
    )
  }
  return {
    dialogMs: milliseconds('window.nativeDialogTimeoutSeconds'),
    stopGraceMs: milliseconds('window.nativeHostStopGraceSeconds'),
  }
}
export type HostProcess = {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  exited: Promise<{ code: number | null; signal: string | null }>
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void
}
export type HostSpawn = (args: readonly string[]) => HostProcess
export function spawnHost(args: readonly string[]): HostProcess {
  const child = spawn(args[0]!, args.slice(1), { stdio: 'pipe' })
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited,
    kill: (signal = 'SIGTERM') => {
      child.kill(signal)
    },
  }
}

// Every signal targets the ChildProcess handle owned by this invocation.
export class NativeHelper {
  readonly process: HostProcess
  readonly exited: HostProcess['exited']
  stderrBytes = 0
  private readonly graceMs: number
  private settled = false
  private stopping: Promise<void> | undefined
  private readonly abort = () => {
    void this.stop()
  }
  constructor(
    args: readonly string[],
    graceMs: number,
    signal?: AbortSignal,
    spawn: HostSpawn = spawnHost,
  ) {
    this.graceMs = graceMs
    signal?.throwIfAborted()
    this.process = spawn(args)
    this.process.stderr.on('data', (bytes: Buffer) => {
      this.stderrBytes += bytes.length
    })
    this.process.stdin.on('error', this.abort)
    this.exited = this.process.exited.finally(() => {
      this.settled = true
      signal?.removeEventListener('abort', this.abort)
    })
    void this.exited.catch(() => {})
    signal?.addEventListener('abort', this.abort, { once: true })
    if (signal?.aborted) this.abort()
  }
  stop(graceful = false): Promise<void> {
    return (this.stopping ??= this.stopProcess(graceful))
  }
  private async stopProcess(graceful: boolean) {
    if (this.settled) return
    if (graceful) await this.waitForExit()
    if (this.settled) return
    this.process.kill('SIGTERM')
    await this.waitForExit()
    if (!this.settled) this.process.kill('SIGKILL')
    await this.exited.catch(() => {})
  }
  private async waitForExit() {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.exited.catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.graceMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
