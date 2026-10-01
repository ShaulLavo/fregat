import * as React from 'react'

import { FocusRegistry } from '@/commands/state/focus'

import type { renderTui } from './render'

type Frame = Awaited<ReturnType<typeof renderTui>>

type FocusChange = {
  readonly atMs: number
  readonly to: string
  readonly from: string
  readonly insideAct: boolean
  readonly callsite: string
}

type FocusRequest = {
  readonly atMs: number
  readonly destination: string
  readonly insideAct: boolean
  readonly callsite: string
}

type PendingTimer = {
  readonly scheduledAtMs: number
  readonly delayMs: number
  readonly callsite: string
}

// React sets this queue only while an act() scope is open.
type ReactInternals = { readonly actQueue: unknown }
const reactInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: ReactInternals
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/**
 * Records every focus change on the frame's renderer and every timer scheduled meanwhile, so a
 * failing focus assertion can print what moved focus, when, from where, and what was still
 * pending. Silent unless `dump()` is called.
 */
export function traceFocus(frame: Frame) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const changes: FocusChange[] = []
  const pending = new Map<unknown, PendingTimer>()

  const onFocus = (to: { id?: string } | null, from: { id?: string } | null) => {
    changes.push({
      atMs: elapsed(),
      callsite: callsite(),
      from: from?.id ?? 'nothing',
      insideAct: reactInternals?.actQueue != null,
      to: to?.id ?? 'nothing',
    })
  }
  frame.renderer.on('focused_renderable', onFocus)

  // A focus move lands later than its request; the request's callsite names who asked.
  const requests: FocusRequest[] = []
  const realRequest = FocusRegistry.prototype.request
  FocusRegistry.prototype.request = function (this: FocusRegistry, ...args) {
    const [destination] = args
    requests.push({
      atMs: elapsed(),
      callsite: callsite(),
      destination: destination.kind,
      insideAct: reactInternals?.actQueue != null,
    })
    return realRequest.apply(this, args)
  }

  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = ((
    handler: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const entry = { callsite: callsite(), delayMs: delay ?? 0, scheduledAtMs: elapsed() }
    const timer = realSetTimeout(
      (...callArgs: unknown[]) => {
        pending.delete(timer)
        handler(...callArgs)
      },
      delay,
      ...args,
    )
    pending.set(timer, entry)
    return timer
  }) as typeof setTimeout
  globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => {
    pending.delete(timer)
    realClearTimeout(timer)
  }) as typeof clearTimeout

  return {
    dump() {
      const now = elapsed()
      const focus = changes.map(
        (change) =>
          `  +${change.atMs}ms ${change.from} -> ${change.to} ${change.insideAct ? 'inside act' : 'OUTSIDE act'}\n${change.callsite}`,
      )
      const asked = requests.map(
        (request) =>
          `  +${request.atMs}ms ${request.destination} ${request.insideAct ? 'inside act' : 'OUTSIDE act'}\n${request.callsite}`,
      )
      const timers = [...pending.values()].map(
        (timer) =>
          `  scheduled +${timer.scheduledAtMs}ms, ${timer.delayMs}ms delay, pending ${now - timer.scheduledAtMs}ms\n${timer.callsite}`,
      )
      return [
        `focus trace at +${now}ms: now ${frame.renderer.currentFocusedRenderable?.id ?? 'nothing'}`,
        `focus changes (${changes.length}):`,
        ...focus,
        `focus requests (${asked.length}):`,
        ...asked,
        `pending timers (${timers.length}):`,
        ...timers,
      ].join('\n')
    },
    stop() {
      frame.renderer.off('focused_renderable', onFocus)
      FocusRegistry.prototype.request = realRequest
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    },
  }
}

// The first frames outside node_modules and this file: the code that moved focus or set a timer.
function callsite() {
  const holder: { stack?: string } = {}
  Error.captureStackTrace(holder, callsite)
  return (holder.stack ?? '')
    .split('\n')
    .slice(1)
    .filter((line) => !line.includes('node_modules') && !line.includes('focus-trace.ts'))
    .slice(0, 6)
    .map((line) => `      ${line.trim()}`)
    .join('\n')
}
