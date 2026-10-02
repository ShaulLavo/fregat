import * as React from 'react'
import { onTestFinished } from 'vitest'

import { FocusRegistry } from '@/commands/state/focus'
import type { renderTui } from './render'

type Frame = Pick<Awaited<ReturnType<typeof renderTui>>, 'renderer'>

// A stack captured now and formatted only if the trace is printed.
type Callsite = { readonly stack?: string }

type FocusChange = {
  readonly atMs: number
  readonly to: string
  readonly from: string
  readonly insideAct: boolean
  readonly callsite: Callsite
}

type FocusRequest = {
  readonly atMs: number
  readonly destination: string
  readonly insideAct: boolean
  readonly callsite: Callsite
}

type PendingTimer = {
  readonly scheduledAtMs: number
  readonly delayMs: number
  readonly callsite: Callsite
}

// React sets this queue only while an act() scope is open.
const reactInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { readonly actQueue: unknown }
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
const insideAct = () => reactInternals?.actQueue != null

/**
 * Records, until the current test finishes, every focus change on the frame's renderer, every
 * focus request with the code that made it, and every timer scheduled meanwhile. When the test
 * fails, timeouts included, the record is printed; it is silent when the test passes.
 */
export function traceFocus(frame: Frame) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const changes: FocusChange[] = []
  const requests: FocusRequest[] = []
  const pending = new Map<unknown, PendingTimer>()

  const onFocus = (to: { id?: string } | null, from: { id?: string } | null) => {
    changes.push({
      atMs: elapsed(),
      callsite: capture(),
      from: from?.id ?? 'nothing',
      insideAct: insideAct(),
      to: to?.id ?? 'nothing',
    })
  }
  frame.renderer.on('focused_renderable', onFocus)

  // A focus move lands later than its request, so the request names who moved focus.
  const realRequest = FocusRegistry.prototype.request
  FocusRegistry.prototype.request = function (this: FocusRegistry, ...args) {
    requests.push({
      atMs: elapsed(),
      callsite: capture(),
      destination: args[0].kind,
      insideAct: insideAct(),
    })
    return realRequest.apply(this, args)
  }

  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = function (this: unknown, handler: unknown, ...rest: unknown[]) {
    const entry = { callsite: capture(), delayMs: Number(rest[0] ?? 0), scheduledAtMs: elapsed() }
    const wrapped =
      typeof handler === 'function'
        ? function (this: unknown, ...args: unknown[]) {
            pending.delete(timer)
            return Reflect.apply(handler, this, args)
          }
        : handler
    const timer: unknown = Reflect.apply(realSetTimeout, this, [wrapped, ...rest])
    pending.set(timer, entry)
    return timer
  } as typeof setTimeout
  globalThis.clearTimeout = function (this: unknown, ...args: unknown[]) {
    pending.delete(args[0])
    return Reflect.apply(realClearTimeout, this, args)
  } as typeof clearTimeout

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    frame.renderer.off('focused_renderable', onFocus)
    FocusRegistry.prototype.request = realRequest
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }

  const dump = () => {
    const now = elapsed()
    const act = (inside: boolean) => (inside ? 'inside act' : 'OUTSIDE act')
    return [
      `focus trace at +${now}ms: now ${frame.renderer.currentFocusedRenderable?.id ?? 'nothing'}`,
      `focus changes (${changes.length}):`,
      ...changes.map(
        (change) =>
          `  +${change.atMs}ms ${change.from} -> ${change.to} ${act(change.insideAct)}\n${format(change.callsite)}`,
      ),
      `focus requests (${requests.length}):`,
      ...requests.map(
        (request) =>
          `  +${request.atMs}ms ${request.destination} ${act(request.insideAct)}\n${format(request.callsite)}`,
      ),
      `pending timers (${pending.size}):`,
      ...[...pending.values()].map(
        (timer) =>
          `  scheduled +${timer.scheduledAtMs}ms, ${timer.delayMs}ms delay, pending ${now - timer.scheduledAtMs}ms\n${format(timer.callsite)}`,
      ),
    ].join('\n')
  }

  // Runs when Vitest times a test out too, which skips the test body's catch and finally.
  onTestFinished(({ task }) => {
    if (task.result?.state === 'fail') console.error(dump())
    stop()
  })
  return { dump, stop }
}

function capture(): Callsite {
  const holder: { stack?: string } = {}
  Error.captureStackTrace(holder, capture)
  return holder
}

// The first frames outside node_modules and this file: the code that acted.
function format(callsite: Callsite) {
  return (callsite.stack ?? '')
    .split('\n')
    .slice(1)
    .filter((line) => !line.includes('node_modules') && !line.includes('focus-trace.ts'))
    .slice(0, 6)
    .map((line) => `      ${line.trim()}`)
    .join('\n')
}
