export const PROPORTIONAL_INTACT_NODE_CEILING = 5_000

/** Positions belong to the intact connected row, including insertion points inside ligatures. */
export function createNativeCarets(
  element: HTMLElement,
  node: Text,
  scale: () => number = () => 1,
) {
  const length = node.length
  const positions = new Map<number, number>()
  // An empty collapsed Range has no text box in Chromium and WebKit.
  if (length === 0) positions.set(0, 0)
  const range = element.ownerDocument.createRange()
  const position = (column: number): number => {
    const known = positions.get(column)
    if (known !== undefined) return known
    range.setStart(node, column)
    range.collapse(true)
    const x = (range.getBoundingClientRect().left - element.getBoundingClientRect().left) / scale()
    positions.set(column, x)
    return x
  }
  return {
    position,
    columnAt(pixels: number, bias: 'before' | 'after'): number {
      let low = 0
      let high = length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (position(middle) <= pixels) low = middle
        else high = middle - 1
      }
      if (bias === 'after' && low < length && position(low) < pixels) return low + 1
      return low
    },
  }
}

export type NativeCarets = ReturnType<typeof createNativeCarets>
