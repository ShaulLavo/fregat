import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import type { EditorResolvedSelection } from '@singapore-editor/core/extensions'
import type { DiffReloadView } from '@/features/git/utils/reload-schema'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DiffFile, DiffRegionStore } from '@singapore-editor/diff'
import type { GitFileDiff } from '@workspace/contracts'
import { captureDiffView, savedDiffView } from '@/features/git/state/reload'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

type Pane = {
  selections: readonly EditorResolvedSelection[]
  scroll: { top: number; left: number } | null
}
type Presentation = {
  restoreDiffView(file: DiffFile, view: DiffReloadView): void
  regions: DiffRegionStore
  diffLayout: Record<string, number> | undefined
  diffPanes: Readonly<Record<'old' | 'new' | 'stacked', Pane>>
}

export function useDiffReloadView(
  identity: string,
  diffs: readonly GitFileDiff[],
  file: DiffFile | null,
  presentation: Presentation,
) {
  const owner = useQueryClient()
  const generation = useGitReloadOwner(owner)
  const [restoredIdentity, setRestoredIdentity] = useState<string | null>(null)
  if (file && restoredIdentity !== identity) {
    const view = savedDiffView(owner, identity)
    if (view) presentation.restoreDiffView(file, view)
    setRestoredIdentity(identity)
  }
  useEffect(() => {
    if (!file || !diffs.length) return
    const flush = () =>
      captureDiffView(owner, generation, identity, {
        expanded: [...presentation.regions.getExpandedRegions()],
        old: presentation.diffPanes.old.scroll,
        new: presentation.diffPanes.new.scroll,
        stacked: presentation.diffPanes.stacked.scroll,
        layout: presentation.diffLayout,
        oldSelections: [...presentation.diffPanes.old.selections],
        newSelections: [...presentation.diffPanes.new.selections],
        stackedSelections: [...presentation.diffPanes.stacked.selections],
      })
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [owner, generation, identity, diffs, file, presentation])
}
