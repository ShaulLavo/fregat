import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import type { DiffReloadView, DiffReloadIdentity } from '@/features/git/utils/reload-schema'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'
import type { DiffAttachment } from '@/lib/diff-attachment'
import { captureDiffView, takeSavedDiffView } from '@/features/git/state/reload'
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
    const view = takeSavedDiffView(owner, identity)
    if (view) presentation.restoreDiffView(attachment, view)
    setRestoredIdentity(key)
  }
  // Cleanups run before this commit's effects, so a flush on leaving still sees the departing diff.
  const shown = useRef({ identity, attachment })
  useEffect(() => {
    shown.current = { identity, attachment }
  })
  const active = key !== null && attachment !== null && diffs.length > 0
  useEffect(() => {
    if (!active) return
    const flush = () => {
      const { identity: current, attachment: displayed } = shown.current
      if (current && displayed)
        captureDiffView(owner, generation, current, presentation.diffViewRecord(displayed))
    }
    const remove = addLifecycleFlush(flush)
    return () => {
      flush()
      remove()
    }
  }, [active, key, owner, generation, presentation])
}
