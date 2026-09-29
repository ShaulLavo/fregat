import { nowMs } from './timing'

export type ScheduledFrame = { cancel(): void }

export function scheduleFrame(
  callback: FrameRequestCallback,
  target: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'> = globalThis,
): ScheduledFrame {
  if (typeof target.requestAnimationFrame === 'function') {
    // @justification This is the frame scheduler every caller goes through; the handle is returned
    // so the owner cancels it on disposal.
    const handle = target.requestAnimationFrame(callback)
    return { cancel: () => target.cancelAnimationFrame(handle) }
  }
  // @justification Stands in for a frame where no window provides one (workers, tests); cancellable
  // through the same handle as the frame path.
  const handle = setTimeout(() => callback(nowMs()), 0)
  return { cancel: () => clearTimeout(handle) }
}
