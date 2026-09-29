import type { HighlightRegistry } from './virtualizedTextViewTypes'

// WORKAROUND (Gecko): after Highlight range mutations over recycled text nodes
// (row virtualization rewrites `textNode.data` in place, then swaps the row's
// StaticRanges), Firefox intermittently keeps painting ::highlight() from a
// stale snapshot: token colors land at the previous row's offsets (words split
// across colors) or later-registered override buckets stop painting. The
// registered ranges are verifiably correct when this happens — re-registering
// every registry entry in order forces Gecko to rebuild highlight paint.
// Chromium and WebKit do not need this. See docs/display/browser-quirks.md.

const pendingRegistries = new WeakSet<HighlightRegistry>()
let nudgeEnabled: boolean | null = null

export function scheduleHighlightRepaintNudge(registry: HighlightRegistry | null): void {
  if (!registry?.entries) return
  if (!highlightRepaintNudgeEnabled()) return
  if (pendingRegistries.has(registry)) return

  pendingRegistries.add(registry)
  /**
   * @justification Coalesces the re-registration one engine needs to repaint highlights to once per registry per
   * turn; `pendingRegistries` is what makes a second call in the same turn a no-op rather than a
   * second pass.
   */
  queueMicrotask(() => {
    pendingRegistries.delete(registry)
    reregisterHighlights(registry)
  })
}

export function reregisterHighlights(registry: HighlightRegistry): void {
  if (!registry.entries) return

  const entries = Array.from(registry.entries())
  for (const [name] of entries) registry.delete(name)
  for (const [name, highlight] of entries) registry.set(name, highlight)
}

/** Force the Gecko nudge on/off; pass `null` to restore engine detection. */
export function setHighlightRepaintNudgeEnabled(enabled: boolean | null): void {
  nudgeEnabled = enabled
}

function highlightRepaintNudgeEnabled(): boolean {
  if (nudgeEnabled !== null) return nudgeEnabled

  nudgeEnabled = isGecko()
  return nudgeEnabled
}

function isGecko(): boolean {
  // Do not detect via `'MozAppearance' in style` — Firefox 148 no longer
  // exposes the camelCase IDL attribute on CSSStyleDeclaration, so that check
  // is false in current Firefox and silently disables the nudge. The CSS
  // parser still accepts the -moz-appearance alias, and only Firefox UAs
  // carry a "Gecko/<version>" token (Blink and WebKit advertise "like Gecko"
  // without the slash form).
  const css = globalThis.CSS as
    | { supports?: (property: string, value: string) => boolean }
    | undefined
  if (css?.supports?.('-moz-appearance', 'none')) return true
  return /\bGecko\/\d/.test(globalThis.navigator?.userAgent ?? '')
}
