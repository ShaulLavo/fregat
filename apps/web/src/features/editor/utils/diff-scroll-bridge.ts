import type {
  EditorPlugin,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'

export type DiffScrollPosition = {
  readonly top: number
  readonly left: number
}

/** The update kinds that can move the viewport. Anything else cannot have scrolled the pane. */
const SCROLL_KINDS = new Set<EditorViewContributionUpdateKind>(['viewport', 'layout'])

/**
 * Reports where a pane has scrolled to, so the host can mirror it onto the other one.
 *
 * Split-pane scroll sync is host work: `EditorViewContributionContext.setScrollTop` is
 * vertical-only, and a diff has to mirror both axes, which only `Editor.setScrollPosition` can do.
 * Getting the pane's position out promptly AND correctly takes both halves below, and neither
 * alone is enough.
 *
 * **Why not read the scroll element.** The virtualizer redefines `scrollTop` on it to return its
 * own logical offset, and folds a scroll into that offset in a `requestAnimationFrame` it schedules
 * from the very same event — so a `scroll` listener reading the element sees the offset from before
 * the scroll it is being told about. `Editor.getScrollPosition()` reads the same field and is stale
 * in the same way. A mirror driven from either is a frame behind and, worse, misses entirely any
 * gesture whose whole delta lands in one event.
 *
 * **Why not the `update` hook alone.** It carries the folded offset and is the authoritative
 * signal, but it is deliberately throttled: `shouldEmitImmediately` suppresses a scroll frame whose
 * mounted row window does not change, deferring to one trailing emit "once scrolling stops"
 * (fixedRowVirtualizer.ts). Measured against a real wheel, that left the mirror **seven frames**
 * behind the pane being driven — which is the jank.
 *
 * So: the `scroll` event for promptness, one rAF later for correctness. The virtualizer registers
 * its own listener when the scroll element is attached, before any plugin exists, so its fold is
 * scheduled first and has already run by the time ours does. `getSnapshot()` builds a fresh
 * snapshot per call (`Editor.createViewSnapshot`), so what we read there is the folded truth, one
 * frame after the scroll rather than a hundred milliseconds after it stops.
 */
export function createDiffScrollBridgePlugin(
  onScroll: (position: DiffScrollPosition) => void,
): EditorPlugin {
  return {
    name: 'platform-diff-scroll-bridge',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => {
          const element = viewContext.scrollElement
          let frame = 0

          const report = () => {
            const { viewport } = viewContext.getSnapshot()
            onScroll({ left: viewport.scrollLeft, top: viewport.scrollTop })
          }

          // Coalesced: a wheel delivers scroll events faster than frames, and every one of them
          // would otherwise queue another read of the same folded value.
          const handleScroll = () => {
            if (frame !== 0) return

            frame = requestAnimationFrame(() => {
              frame = 0
              report()
            })
          }
          element.addEventListener('scroll', handleScroll, { passive: true })

          return {
            update: (_snapshot, kind) => {
              // Still needed: a programmatic move, a layout change or a clamp produces no scroll
              // event of its own on some paths, and this is the signal that carries those.
              if (SCROLL_KINDS.has(kind)) report()
            },
            dispose: () => {
              if (frame !== 0) cancelAnimationFrame(frame)
              element.removeEventListener('scroll', handleScroll)
            },
          }
        },
      }),
  }
}
