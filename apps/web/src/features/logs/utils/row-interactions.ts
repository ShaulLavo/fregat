const LOG_ROW_CLICK_MOVEMENT_TOLERANCE_PX = 4

export type LogRowPointerStart = {
  x: number
  y: number
} | null

export function logRowPointerStart(event: { clientX: number; clientY: number }) {
  return { x: event.clientX, y: event.clientY }
}

export function shouldToggleLogRow(
  event: { clientX: number; clientY: number },
  pointerStart: LogRowPointerStart,
) {
  if (isClickMovement(event, pointerStart)) return true

  return false
}

function isClickMovement(
  event: { clientX: number; clientY: number },
  pointerStart: LogRowPointerStart,
) {
  if (!pointerStart) return true

  const movedX = Math.abs(event.clientX - pointerStart.x)
  const movedY = Math.abs(event.clientY - pointerStart.y)

  return (
    movedX <= LOG_ROW_CLICK_MOVEMENT_TOLERANCE_PX && movedY <= LOG_ROW_CLICK_MOVEMENT_TOLERANCE_PX
  )
}
