import { createInterface } from 'node:readline'
import type { PlatformPickOptions } from '../shared/bridge'
import { recordDesktopInfo } from '../bun/observability'
import {
  NativeHelper,
  nativeBudget,
  nativeErrors,
  type NativeBudget,
  type HostSpawn,
} from './native-helper'
import { startupBudget, type StartupBudget } from './startup'

export type WebviewCommand = { eval: string } | { pick: PlatformPickOptions } | { close: true }
export type WebviewEvent =
  | { event: 'ready' }
  | { event: 'message'; body: unknown }
  | { event: 'picked'; paths: string[] }
  | { event: 'closed' }
function parseWebviewEvent(line: string): WebviewEvent {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || !('event' in value))
    throw nativeErrors.HOST_FAILED({ internal: { stage: 'event-shape' } })
  if (value.event === 'ready' || value.event === 'closed') return { event: value.event }
  if (value.event === 'message' && 'body' in value) return { event: 'message', body: value.body }
  if (
    value.event === 'picked' &&
    'paths' in value &&
    Array.isArray(value.paths) &&
    value.paths.every((p: unknown) => typeof p === 'string')
  )
    return { event: 'picked', paths: value.paths }
  throw nativeErrors.HOST_FAILED({ internal: { stage: 'event-kind' } })
}
export type WebviewHostOptions = {
  binary: string
  url: string
  initScriptPath: string
  spawn?: HostSpawn
  signal?: AbortSignal
  budget?: NativeBudget
  startup?: StartupBudget
  onEvent?: (event: WebviewEvent) => void
  cleanupOwnedWindow: () => void | Promise<void>
  recordOpen?: (context: Record<string, unknown>) => void
}
// Stdio is a streaming transport; the queue matches picker replies to their single caller.
export class WebviewHost {
  readonly capabilities = { displayCapture: false } as const
  readonly ready: Promise<void>
  readonly exited: Promise<void>
  private readonly helper: NativeHelper
  private state: 'starting' | 'open' | 'closing' | 'closed' = 'starting'
  private pendingPick: ReturnType<typeof Promise.withResolvers<string[]>> | undefined
  private picks: Promise<unknown> = Promise.resolve()
  private recordedOpen = false
  private readonly budget: NativeBudget
  constructor(options: WebviewHostOptions) {
    this.budget = options.budget ?? nativeBudget()
    const ready = Promise.withResolvers<void>()
    this.ready = ready.promise
    this.helper = new NativeHelper(
      [options.binary, options.url, options.initScriptPath],
      this.budget.stopGraceMs,
      options.signal,
      options.spawn,
    )
    const startupTimer = setTimeout(
      () => {
        void this.helper.stop()
      },
      (options.startup ?? startupBudget()).limitMs,
    )
    void this.ready.finally(() => clearTimeout(startupTimer)).catch(() => {})
    const reading = this.readEvents(options, ready)
    this.exited = this.waitForExit(options, ready, reading)
    void this.ready.catch(() => {})
    void this.exited.catch(() => {})
  }
  evaluate(script: string) {
    this.send({ eval: script })
  }
  pick(options: PlatformPickOptions): Promise<string[]> {
    const result = this.picks.then(async () => {
      await this.ready
      const pending = Promise.withResolvers<string[]>()
      this.pendingPick = pending
      const timer = setTimeout(() => {
        void this.helper.stop()
      }, this.budget.dialogMs)
      try {
        this.send({ pick: options })
        return await pending.promise
      } finally {
        clearTimeout(timer)
        this.pendingPick = undefined
      }
    })
    this.picks = result.catch(() => {})
    return result
  }
  async close() {
    if (this.state === 'closed') return
    if (this.state !== 'closing') {
      this.send({ close: true })
      this.state = 'closing'
    }
    await this.helper.stop(true)
    await this.exited
  }
  private send(command: WebviewCommand) {
    if (this.state === 'closed' || this.state === 'closing')
      throw nativeErrors.HOST_FAILED({ internal: { stage: 'write', state: this.state } })
    this.helper.process.stdin.write(`${JSON.stringify(command)}\n`)
  }
  private async readEvents(
    options: WebviewHostOptions,
    ready: ReturnType<typeof Promise.withResolvers<void>>,
  ) {
    const lines = createInterface({ input: this.helper.process.stdout, crlfDelay: Infinity })
    this.helper.process.stdout.once('close', () => lines.close())
    try {
      for await (const line of lines) {
        const event = parseWebviewEvent(line)
        if (event.event === 'ready' && this.state === 'starting') {
          this.state = 'open'
          ready.resolve()
        }
        if (event.event === 'picked') this.pendingPick?.resolve(event.paths)
        if (event.event === 'message') this.recordFrames(event.body, options)
        options.onEvent?.(event)
      }
    } catch {
      await this.helper.stop()
      throw nativeErrors.HOST_FAILED({ internal: { stage: 'protocol' } })
    }
  }
  private recordFrames(body: unknown, options: WebviewHostOptions) {
    if (
      this.recordedOpen ||
      typeof body !== 'object' ||
      body === null ||
      !('platformHostRaf' in body)
    )
      return
    if (
      typeof body.platformHostRaf !== 'number' ||
      !Number.isFinite(body.platformHostRaf) ||
      body.platformHostRaf < 0
    )
      return
    this.recordedOpen = true
    const context = { engine: 'webkitgtk', rafPerSecond: body.platformHostRaf }
    if (options.recordOpen) options.recordOpen(context)
    else recordDesktopInfo('desktop.window.open', context)
  }
  private async waitForExit(
    options: WebviewHostOptions,
    ready: ReturnType<typeof Promise.withResolvers<void>>,
    reading: Promise<void>,
  ) {
    const outcome = await Promise.allSettled([this.helper.exited, reading])
    const previous = this.state
    this.state = 'closed'
    const processResult = outcome[0]!
    const failure = nativeErrors.HOST_FAILED({
      internal: {
        stage: 'exit',
        code: processResult.status === 'fulfilled' ? processResult.value.code : null,
        signal: processResult.status === 'fulfilled' ? processResult.value.signal : null,
        stderrBytes: this.helper.stderrBytes,
      },
    })
    ready.reject(failure)
    this.pendingPick?.reject(failure)
    await options.cleanupOwnedWindow()
    if (
      previous === 'starting' ||
      outcome.some((result) => result.status === 'rejected') ||
      (previous !== 'closing' &&
        processResult.status === 'fulfilled' &&
        processResult.value.code !== 0)
    )
      throw failure
  }
}

export async function runNativeDialog(options: {
  binary: string
  args: readonly string[]
  budget?: NativeBudget
  signal?: AbortSignal
  spawn?: HostSpawn
}): Promise<WebviewEvent[]> {
  const budget = options.budget ?? nativeBudget()
  const helper = new NativeHelper(
    [options.binary, ...options.args],
    budget.stopGraceMs,
    options.signal,
    options.spawn,
  )
  const timer = setTimeout(() => {
    void helper.stop()
  }, budget.dialogMs)
  const events: WebviewEvent[] = []
  const lines = createInterface({ input: helper.process.stdout, crlfDelay: Infinity })
  helper.process.stdout.once('close', () => lines.close())
  const reading = (async () => {
    try {
      for await (const line of lines) events.push(parseWebviewEvent(line))
    } catch {
      await helper.stop()
      throw nativeErrors.HOST_FAILED({ internal: { stage: 'dialog-protocol' } })
    }
  })()
  try {
    const result = await Promise.allSettled([helper.exited, reading])
    options.signal?.throwIfAborted()
    if (
      result[0]!.status !== 'fulfilled' ||
      result[0]!.value.code !== 0 ||
      result[1]!.status !== 'fulfilled'
    )
      throw nativeErrors.HOST_FAILED({
        internal: {
          stage: 'dialog-exit',
          code: result[0]!.status === 'fulfilled' ? result[0]!.value.code : null,
          stderrBytes: helper.stderrBytes,
        },
      })
    return events
  } finally {
    clearTimeout(timer)
    await helper.stop()
  }
}
export async function pick(options: {
  binary: string
  options: PlatformPickOptions
  budget?: NativeBudget
  signal?: AbortSignal
  spawn?: HostSpawn
}): Promise<string[]> {
  const events = await runNativeDialog({
    ...options,
    args: ['pick', JSON.stringify(options.options)],
  })
  const picked = events.find((event) => event.event === 'picked')
  if (!picked || picked.event !== 'picked')
    throw nativeErrors.HOST_FAILED({ internal: { stage: 'pick-response' } })
  return picked.paths
}
