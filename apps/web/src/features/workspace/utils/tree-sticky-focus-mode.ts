// The sticky overlay can preserve keyboard focus in exactly one of three ways
// at a time. Modelling it as a union makes "exactly one preservation mode
// active" a type-level fact instead of a comment over three coupled refs.
export type StickyKeyboardFocusMode =
  | { readonly kind: 'none' }
  | { readonly kind: 'focus-path'; readonly path: string; readonly scrollTop: number | null }
  | { readonly kind: 'viewport-offset'; readonly path: string; readonly viewportOffset: number }

export const NO_STICKY_KEYBOARD_FOCUS: StickyKeyboardFocusMode = { kind: 'none' }

/**
 * The focus path is set whether or not a scroll-top came with it — the ref this
 * replaces assigned the path unconditionally and only the scroll-top
 * conditionally. Collapsing the two would silently break sticky Shift+F10.
 */
export function preserveStickyKeyboardFocusAtScrollTop(
  path: string,
  scrollTop: number | null,
): StickyKeyboardFocusMode {
  return { kind: 'focus-path', path, scrollTop }
}

export function restoreStickyKeyboardViewportOffset(
  path: string,
  viewportOffset: number,
): StickyKeyboardFocusMode {
  return { kind: 'viewport-offset', path, viewportOffset }
}

/**
 * Mirrors the three independent `=== focusedPath` clears this replaces. All
 * three legacy refs were written together and carried the same path, so one
 * check is equivalent to three.
 */
export function settleStickyKeyboardFocus(
  mode: StickyKeyboardFocusMode,
  focusedPath: string | null,
): StickyKeyboardFocusMode {
  if (mode.kind === 'none') return mode
  if (mode.path !== focusedPath) return mode

  return NO_STICKY_KEYBOARD_FOCUS
}

/** Non-null only while focus-path preservation is the active mode. */
export function getStickyKeyboardFocusPath(mode: StickyKeyboardFocusMode): string | null {
  if (mode.kind !== 'focus-path') return null

  return mode.path
}

/**
 * The entry, not the bare number: the caller compares its `path` against the
 * focused row before honouring the scroll-top, exactly as the ref did.
 */
export function getStickyKeyboardScrollTopEntry(
  mode: StickyKeyboardFocusMode,
): { path: string; scrollTop: number } | null {
  if (mode.kind !== 'focus-path') return null
  if (mode.scrollTop == null) return null

  return { path: mode.path, scrollTop: mode.scrollTop }
}

/** Non-null only while viewport-offset restoration is the active mode. */
export function getStickyKeyboardViewportOffsetEntry(
  mode: StickyKeyboardFocusMode,
): { path: string; viewportOffset: number } | null {
  if (mode.kind !== 'viewport-offset') return null

  return { path: mode.path, viewportOffset: mode.viewportOffset }
}
