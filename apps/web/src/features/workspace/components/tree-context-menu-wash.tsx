/** @jsxImportSource react */
import type { JSX } from 'react'

/**
 * Covers the tree while its menu is open: a press anywhere on it closes the menu, and wheel and
 * touch moves are eaten, so the rows under an open menu neither scroll nor react.
 */
export function TreeContextMenuWash({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <div
      data-type='context-menu-wash'
      aria-hidden='true'
      onMouseDownCapture={(event) => {
        event.preventDefault()
        onClose()
      }}
      onTouchStartCapture={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onTouchMoveCapture={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onWheelCapture={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )
}
