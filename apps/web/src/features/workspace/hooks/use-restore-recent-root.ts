import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { useAddressRootClaimed } from '@/features/address/state/root-claim'
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

/**
 * Browser storage only remembers the active root locally. When it is missing, the
 * file server's newest recent directory is the next-best durable source of truth.
 */
export function useRestoreRecentWorkspaceRoot() {
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const workspaceStore = useEditorWorkspaceStoreApi()
  const openWorkspaceRoot = useOpenWorkspaceRoot()
  const attemptedRootPath = useRef<string | null>(null)
  const [settledRootPath, setSettledRootPath] = useState<string | null>(null)
  const recentFolders = useQuery(recentFoldersQueryOptions({ enabled: rootPath === null }))
  const recentRootPath = recentFolders.data?.[0]?.path ?? null
  // A link names a workspace explicitly; recents is a guess. While the address applier
  // is still resolving one, this must not fill the slot — both call `openWorkspaceRoot`
  // and the later caller wins, so the guess was beating the instruction roughly half
  // the time on a machine with no cached root. Released as soon as the applier settles,
  // so a dead link still falls back here rather than leaving the app empty.
  const addressClaimsRoot = useAddressRootClaimed()

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

  return (
    rootPath === null &&
    (addressClaimsRoot ||
      recentFolders.isPending ||
      (recentRootPath !== null && recentRootPath !== settledRootPath))
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
