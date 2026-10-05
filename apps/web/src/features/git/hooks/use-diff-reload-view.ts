import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import type { EditorResolvedSelection } from '@singapore-editor/core/extensions'
import type { DiffReloadView, DiffReloadIdentity } from '@/features/git/utils/reload-schema'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DiffRegionStore } from '@singapore-editor/diff'
import type { GitFileDiff } from '@workspace/contracts'
import type { DiffAttachment } from '@/lib/diff-attachment'
import { captureDiffView, savedDiffView } from '@/features/git/state/reload'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

type Pane = {
  selections: readonly EditorResolvedSelection[]
  scroll: { top: number; left: number } | null
}
type Presentation = {
  restoreDiffView(attachment: DiffAttachment, view: DiffReloadView): void
  regions: DiffRegionStore
  diffLayout: Record<string, number> | undefined
  diffPanes: Readonly<Record<'old' | 'new' | 'stacked', Pane>>
}

export function useDiffReloadView(
  identity: DiffReloadIdentity | null,
  diffs: readonly GitFileDiff[],
  attachment: DiffAttachment | null,
  presentation: Presentation,
) {
  const file = attachment?.file ?? null
  const owner = useQueryClient()
  const generation = useGitReloadOwner(owner)
  const [restoredIdentity, setRestoredIdentity] = useState<string | null>(null)
  const key = identity ? JSON.stringify(identity) : null
  if (file && identity && restoredIdentity !== key) {
    const view = savedDiffView(owner, identity)
    if (view && attachment) presentation.restoreDiffView(attachment, view)
    setRestoredIdentity(key)
  }
  useEffect(() => {
    if (!file || !diffs.length || !identity) return
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
