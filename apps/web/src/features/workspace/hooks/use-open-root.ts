import { useCallback } from 'react'
import { useNavigation } from '@/hooks/use-navigation'
import { useQueryClient } from '@tanstack/react-query'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { OpenWorkspaceRootResult } from '@/features/workspace/state/open-root'
export type { OpenWorkspaceRootResult } from '@/features/workspace/state/open-root'

export function useOpenWorkspaceRoot() {
  const navigation = useNavigation()
  const workspace = useEditorWorkspaceStoreApi()
  const environmentId = confirmedEnvironmentId(originForQueryClient(useQueryClient()))
  // Recent-root recovery keeps this opener in its effect dependencies.
  return useCallback(
    async (path: string): Promise<OpenWorkspaceRootResult> => {
      const previousRoot = workspace.getState().rootFolder?.path
      const result = await navigation.openWorkspace({ environmentId, path })
      if (result.status === 'applied') {
        const currentRoot = workspace.getState().rootFolder?.path
        return previousRoot !== undefined && previousRoot === currentRoot
          ? 'already-open'
          : 'opened'
      }
      return result.status === 'superseded' ? 'superseded' : 'failed'
    },
    [navigation, environmentId, workspace],
  )
}
