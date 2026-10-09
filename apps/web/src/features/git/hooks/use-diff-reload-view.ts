import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import type { DiffReloadView, DiffReloadIdentity } from '@/features/git/utils/reload-schema'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'
import type { DiffAttachment } from '@/lib/diff-attachment'
import { captureDiffView, savedDiffView } from '@/features/git/state/reload'
import { addLifecycleFlush } from '@/lib/lifecycle-flush'

type Presentation = {
  restoreDiffView(attachment: DiffAttachment, view: DiffReloadView): void
  diffViewRecord(attachment: DiffAttachment): DiffReloadView
}

export function useDiffReloadView(
  identity: DiffReloadIdentity | null,
  diffs: readonly GitFileDiff[],
  attachment: DiffAttachment | null,
  presentation: Presentation,
) {
  const owner = useQueryClient()
  const generation = useGitReloadOwner(owner)
  const [restoredIdentity, setRestoredIdentity] = useState<string | null>(null)
  const key = identity ? JSON.stringify(identity) : null
  if (attachment && identity && restoredIdentity !== key) {
    const view = savedDiffView(owner, identity)
    if (view) presentation.restoreDiffView(attachment, view)
    setRestoredIdentity(key)
  }
  useEffect(() => {
    if (!attachment || !diffs.length || !identity) return
    const flush = () =>
      captureDiffView(owner, generation, identity, presentation.diffViewRecord(attachment))
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [owner, generation, identity, diffs, attachment, presentation])
}
