import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useStatus } from '@/features/git/hooks/use-status'
import { captureGitStatus, savedGit } from '@/features/git/state/reload'

export function useStatusDisplay(root: string) {
  const owner = useQueryClient()
  const generation = useGitReloadOwner(owner)
  const query = useStatus(root)
  useEffect(() => {
    if (query.data) captureGitStatus(owner, root, query.data)
  }, [owner, root, query.data, generation])
  const saved = query.data ? undefined : savedGit(owner, root)?.status
  return {
    ...query,
    data: query.data ?? saved,
    saved: Boolean(saved),
    isPending: query.isPending && !saved,
  }
}
