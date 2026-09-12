export type MenuAnchorRect = {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

/**
 * A floating-ui virtual element. Base UI's Positioner accepts one in place of
 * a real DOM node, which is what lets a menu open at a cursor point on a
 * surface that has no element to wrap in a trigger — the terminal canvas, the
 * shadow-DOM file tree, or a keyboard invocation at the editor caret.
 */
export type MenuAnchor = {
  readonly contextElement?: Element
  readonly getBoundingClientRect: () => DOMRect
}

/**
 * Coordinates must be viewport-relative. Under a ContextMenu root the
 * positioner is forced to `position: fixed`, so page coordinates would be
 * wrong by the scroll offset.
 */
export function pointAnchor(
  clientX: number,
  clientY: number,
  contextElement?: Element,
): MenuAnchor {
  return rectAnchor({ height: 0, width: 0, x: clientX, y: clientY }, contextElement)
}

export function rectAnchor(rect: MenuAnchorRect, contextElement?: Element): MenuAnchor {
  const frozen = toDomRect(rect)

  return contextElement
    ? { contextElement, getBoundingClientRect: () => frozen }
    : { getBoundingClientRect: () => frozen }
}

/**
 * Built by hand rather than via `DOMRect.fromRect` so menu builders stay
 * testable in the `node` project, which has no DOM globals.
 */
function toDomRect({ height, width, x, y }: MenuAnchorRect): DOMRect {
  const rect = {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
  }

  return { ...rect, toJSON: () => rect } as DOMRect
}
