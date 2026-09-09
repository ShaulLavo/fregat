import { useQueries } from '@tanstack/react-query'
import { registerWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { projectMenuModel } from '@/features/workbench/utils/project-menu-model'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useProjectMenuEntries({
  enabled,
  ...input
}: Parameters<typeof projectMenuModel>[0] & { readonly enabled: boolean }) {
  const candidates = projectMenuModel(input).filter(
    (entry) => entry.rootPath !== input.activeRootPath,
  )
  const resolved = useQueries({
    queries: candidates.map((entry) => ({
      enabled,
      queryKey: ['project-menu', 'canonical-root', entry.rootPath],
      queryFn: ({ signal, client }) =>
        registerWorkspaceAddress({
          client: clientForQueryClient(client),
          path: entry.rootPath,
          signal,
        }),
      retry: false,
      staleTime: 30_000,
    })),
  })
  const recentFolders = candidates.flatMap((entry, index) => {
    const result = resolved[index]
    if (!result || result.isPending) return []
    return [{ name: entry.title, path: result.data?.path ?? entry.rootPath }]
  })

  return {
    entries: projectMenuModel({ ...input, projects: [], recentFolders }),
    isPending: resolved.some((result) => result.isPending),
  }
}
