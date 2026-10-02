import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void) {
  const overlay = navigator.windowControlsOverlay
  overlay?.addEventListener('geometrychange', notify)
  return () => overlay?.removeEventListener('geometrychange', notify)
}

function snapshot(): string | null {
  const overlay = navigator.windowControlsOverlay
  if (!overlay?.visible) return null
  const rect = overlay.getTitlebarAreaRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return `${rect.x},${rect.y},${rect.width},${rect.height}`
}

export function useWindowControlsOverlay() {
  const geometry = useSyncExternalStore(subscribe, snapshot, () => null)
  if (geometry === null) return null
  const [x, y, width, height] = geometry.split(',').map(Number)
  return { x: x!, y: y!, width: width!, height: height! }
}
