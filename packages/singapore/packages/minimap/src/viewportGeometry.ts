export type MinimapScrollGeometry = {
  readonly width: number
  readonly height: number
  readonly clientWidth: number
  readonly clientHeight: number
  readonly borders: {
    readonly left: number
    readonly right: number
    readonly top: number
    readonly bottom: number
  }
  readonly overlayScrollbars: { readonly vertical: number; readonly horizontal: number }
  readonly overflowsX: boolean
  readonly overflowsY: boolean
}

export function minimapViewportGeometry(
  side: 'left' | 'right',
  minimapWidth: number,
  scroll: MinimapScrollGeometry,
) {
  const { width, height, clientWidth, clientHeight, borders, overlayScrollbars } = scroll
  const allocatedVertical = Math.max(0, width - clientWidth - borders.left - borders.right)
  const allocatedHorizontal = Math.max(0, height - clientHeight - borders.top - borders.bottom)
  const vertical = allocatedVertical || (scroll.overflowsY ? overlayScrollbars.vertical : 0)
  const horizontal = allocatedHorizontal || (scroll.overflowsX ? overlayScrollbars.horizontal : 0)
  const extraRight = side === 'right' ? Math.max(0, vertical - allocatedVertical) : 0
  const reservedWidth = Math.ceil(minimapWidth + extraRight)
  return {
    reservedWidth,
    top: borders.top,
    left: borders.left,
    right: borders.right + vertical,
    height: Math.max(0, clientHeight - Math.max(0, horizontal - allocatedHorizontal)),
    verticalScrollbar: vertical,
    horizontalScrollbar: horizontal,
  }
}
