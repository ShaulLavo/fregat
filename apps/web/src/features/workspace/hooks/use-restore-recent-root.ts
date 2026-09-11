import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  useOpenWorkspaceRoot,
  type OpenWorkspaceRootResult,
} from '@/features/workspace/hooks/use-open-root'
import { log } from '@/lib/client-logging'
import { recentFoldersQueryOptions } from '@/lib/recent-folders-query'

export function useRestoreRecentWorkspaceRoot() {
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const workspaceStore = useEditorWorkspaceStoreApi()
  const openWorkspaceRoot = useOpenWorkspaceRoot()
  const attemptedRootPath = useRef<string | null>(null)
  const [settledRootPath, setSettledRootPath] = useState<string | null>(null)
  const navigation = useNavigation()
  const navigationStatus = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const addressClaimsRoot = !navigation.permitsRecentRoot()
  const recentFolders = useQuery(
    recentFoldersQueryOptions({ enabled: rootPath === null && !addressClaimsRoot }),
  )
  const recentRootPath = recentFolders.data?.[0]?.path ?? null

  useEffect(() => {
    if (rootPath !== null) {
      attemptedRootPath.current = null
      return
    }
    if (addressClaimsRoot) return
    if (!recentRootPath) return
    if (attemptedRootPath.current === recentRootPath) return
    if (workspaceStore.getState().rootFolder) return

    attemptedRootPath.current = recentRootPath
    void restoreRecentWorkspaceRoot(recentRootPath, openWorkspaceRoot).finally(() => {
      setSettledRootPath(recentRootPath)
    })
  }, [addressClaimsRoot, openWorkspaceRoot, recentRootPath, rootPath, workspaceStore])

  if (addressClaimsRoot) return navigationStatus.status === 'pending'
  return (
    rootPath === null &&
    (recentFolders.isPending || (recentRootPath !== null && recentRootPath !== settledRootPath))
  )
}

async function restoreRecentWorkspaceRoot(
  rootPath: string,
  openWorkspaceRoot: (rootPath: string) => Promise<OpenWorkspaceRootResult>,
) {
  const result = await openWorkspaceRoot(rootPath)
  if (result !== 'opened') return

  log.info({
    action: 'workspace.root_restored_from_recents',
    area: 'workspace',
    path: rootPath,
  })
}
