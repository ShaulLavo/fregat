import { useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { diffPaintOwner, subscribeDiffPaint } from '@/features/editor/state/diff-paint'

export function useDiffPaintOwner() {
  const owner = useQueryClient()
  return useSyncExternalStore(
    subscribeDiffPaint,
    () => diffPaintOwner(owner),
    () => diffPaintOwner(owner),
  )
}
