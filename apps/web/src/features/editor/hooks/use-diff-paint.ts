import { useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ReactEditorController } from '@singapore-editor/react'
import type { DiffFile, DiffGutterSide, DiffRegionStore } from '@singapore-editor/diff'
import {
  captureDiffPaint,
  savedDiffPaint,
  savedDiffPaintView,
} from '@/features/editor/state/diff-paint'
import { useDiffPaintOwner } from '@/features/editor/hooks/use-diff-paint-owner'

export function useDiffPaint(
  identity: string | undefined,
  file: DiffFile | null,
  side: DiffGutterSide,
  regions: DiffRegionStore,
  getLayout: (() => Record<string, number> | undefined) | undefined,
) {
  const owner = useQueryClient()
  const target = useDiffPaintOwner()
  const expansion = [...regions.getExpandedRegions()].sort()
  const snapshot = savedDiffPaint(target, identity, side, file, expansion)
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (!file || !snapshot || restored.current) return
    restored.current = true
    const pane = savedDiffPaintView(target, identity)?.panes.find((pane) => pane.side === side)
    if (!pane || regions.getExpandedRegions().size > 0) return
    regions.setFile(file)
    for (const key of pane.expansion) regions.toggleRegion(key)
  }, [file, snapshot, target, identity, side, regions])
  return {
    snapshot,
    capture(controller: ReactEditorController) {
      const captured = controller.getEditor()?.captureSnapshot()
      if (!identity || !file || !captured || captured.documentKey !== `${identity}:${side}`) return
      captureDiffPaint(
        owner,
        target,
        identity,
        file,
        side,
        [...regions.getExpandedRegions()].sort(),
        captured.paint,
        getLayout?.(),
      )
    },
  }
}
