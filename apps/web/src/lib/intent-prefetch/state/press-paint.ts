import type { WideEventScope } from '@workspace/observability/scope'
import { roundMs } from '@workspace/utils/timing'

export type PressSurface = 'files' | 'diffs'
/** What an intent had ready when the press landed; `live` is a document already open elsewhere. */
export type PressPrefetch = 'hit' | 'partial' | 'miss' | 'live'
export type PressPaintPhase = 'text' | 'colour'

type OpenPress = {
  readonly scope: WideEventScope
  readonly startedAt: number
  readonly target: string
  readonly timer: ReturnType<typeof setTimeout>
  textMs: number | null
}

// A press whose view never paints (closed, replaced, a binary file) still logs once.
const PRESS_PAINT_TIMEOUT_MS = 10_000

const openPresses = new Map<PressSurface, OpenPress>()

/**
 * Hold `scope` open until the pressed target paints colour, so the open event carries
 * `firstPaint`. One press per surface: a newer press ends the older one as superseded.
 */
export function beginPressPaint(surface: PressSurface, target: string, scope: WideEventScope) {
  finishPress(surface, { superseded: true })
  const timer = setTimeout(() => finishPress(surface, { timedOut: true }), PRESS_PAINT_TIMEOUT_MS)
  openPresses.set(surface, { scope, startedAt: performance.now(), target, timer, textMs: null })
}

export function notePressPrefetch(surface: PressSurface, target: string, prefetch: PressPrefetch) {
  const press = openPresses.get(surface)
  if (press?.target !== target) return

  press.scope.set({ prefetch })
}

export function notePressPaint(
  surface: PressSurface,
  target: string,
  phase: PressPaintPhase,
  detail: Readonly<Record<string, unknown>> = {},
) {
  const press = openPresses.get(surface)
  if (press?.target !== target) return

  const elapsed = roundMs(performance.now() - press.startedAt)
  if (phase === 'text') {
    press.textMs ??= elapsed
    return
  }
  press.textMs ??= elapsed
  finishPress(surface, { ...detail, colourMs: elapsed })
}

/** End the press without a paint: the target was already on screen, or the open failed. */
export function endPressPaint(surface: PressSurface, target: string, reason: string) {
  const press = openPresses.get(surface)
  if (press?.target !== target) return

  finishPress(surface, { endedBy: reason })
}

function finishPress(surface: PressSurface, outcome: Record<string, unknown>) {
  const press = openPresses.get(surface)
  if (!press) return

  openPresses.delete(surface)
  clearTimeout(press.timer)
  press.scope.end({ firstPaint: { textMs: press.textMs, ...outcome } })
}
