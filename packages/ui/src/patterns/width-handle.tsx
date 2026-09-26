import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { cn } from '@workspace/ui/lib/utils'

const KEY_STEP_PX = 16
const KEY_STEP_LARGE_PX = 64

export type WidthHandleProps = {
  /** Names what the handle resizes, such as `Resize Documents column`. */
  label: string
  /** The element's width now, in pixels, for assistive tech. */
  width: number
  min: number
  max: number
  onResize: (width: number) => void
  /** Double-click: size the element to its content. */
  onFit?: () => void
  className?: string
}

/**
 * A separator on the right edge of the element it resizes, in pixels, for strips whose items
 * overflow (percent panels cannot). It looks and moves like `ResizableHandle`: tints only, no
 * motion to reduce, and it stays silent like the panel handles.
 */
export function WidthHandle({
  label,
  width,
  min,
  max,
  onResize,
  onFit,
  className,
}: WidthHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [active, setActive] = useState(false)

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const owner = event.currentTarget.parentElement
    if (!owner) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: owner.getBoundingClientRect().width }
    setActive(true)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    onResize(clampWidth(start.startWidth + event.clientX - start.startX, min, max))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyedWidth(event, width, min, max)
    if (next === null) return
    event.preventDefault()
    onResize(next)
  }

  return (
    <div
      aria-label={label}
      aria-orientation='vertical'
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      className={cn(
        'focus-ring absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none bg-transparent outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-foreground/10 focus-visible:bg-foreground/15 data-[active=true]:bg-foreground/20',
        className,
      )}
      data-active={active}
      data-feedback='silent'
      data-slot='width-handle'
      role='separator'
      tabIndex={0}
      onDoubleClick={onFit}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
    />
  )
}

export function clampWidth(width: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, width)))
}

function keyedWidth(event: KeyboardEvent, width: number, min: number, max: number) {
  const step = event.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX
  if (event.key === 'ArrowLeft') return clampWidth(width - step, min, max)
  if (event.key === 'ArrowRight') return clampWidth(width + step, min, max)
  if (event.key === 'Home') return min
  if (event.key === 'End') return max
  return null
}
