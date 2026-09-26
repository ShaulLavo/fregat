import { projectMenuQueryKeys } from '@/features/workbench/utils/query-keys'
import { useQueries, useQuery } from '@tanstack/react-query'
import { lookupWorkspaceAddresses } from '@workspace/client-core/files/workspace-address'
import { listGitWorktrees } from '@workspace/client-core/git/worktrees'
import { missingAsNull } from '@/features/workbench/utils/missing-as-null'
import { projectMenuModel } from '@/features/workbench/utils/project-menu-model'
import { nestWorktrees } from '@/features/workbench/utils/project-menu-worktrees'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useProjectMenuEntries({
  enabled,
  sourcesPending = false,
  ...input
}: Parameters<typeof projectMenuModel>[0] & {
  readonly enabled: boolean
  readonly sourcesPending?: boolean
}) {
  const candidates = projectMenuModel(input).filter(
    (entry) => entry.rootPath !== input.activeRootPath,
  )
  // Sorted so a reorder of the same candidates reuses the cached answer.
  const candidatePaths = candidates.map((entry) => entry.rootPath).toSorted()
  const resolved = useQuery({
    // Waits for the sources, so one request covers every candidate.
    enabled: enabled && !sourcesPending && candidatePaths.length > 0,
    queryKey: projectMenuQueryKeys.canonicalRoots(candidatePaths),
    queryFn: ({ signal, client }) =>
      lookupWorkspaceAddresses({
        client: clientForQueryClient(client),
        paths: candidatePaths,
        signal,
      }),
    retry: false,
    staleTime: 30_000,
  })
  const rootsPending = sourcesPending || (candidatePaths.length > 0 && resolved.isPending)
  const roots = new Map(resolved.data?.map((entry) => [entry.path, entry.address] as const))
  const recentFolders = candidates.flatMap((entry) => {
    const root = roots.get(entry.rootPath)
    // No canonical root means the folder is gone (a removed worktree) and cannot be opened.
    if (rootsPending || !root) return []
    return [{ name: entry.title, path: root.path }]
  })
  const entries = projectMenuModel({ ...input, projects: [], recentFolders })

  const listed = useQueries({
    queries: entries.map((entry) => ({
      enabled: enabled && !rootsPending,
      queryKey: projectMenuQueryKeys.checkouts(entry.rootPath),
      queryFn: ({ signal, client }) =>
        missingAsNull(
          listGitWorktrees({ client: clientForQueryClient(client), path: entry.rootPath, signal }),
        ),
      retry: false,
      staleTime: 30_000,
    })),
  })
  // Rows land together: a list that grows per settled lookup reads as a repaint.
  const isPending = rootsPending || listed.some((result) => result.isPending)
  if (isPending) return { entries: entries.slice(0, input.activeRootPath ? 1 : 0), isPending }

  const checkoutsByRoot = new Map(
    entries.map((entry, index) => [entry.rootPath, listed[index]?.data ?? []]),
  )
  return { entries: nestWorktrees(entries, checkoutsByRoot), isPending }
}
