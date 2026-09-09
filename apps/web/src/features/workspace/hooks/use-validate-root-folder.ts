import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import type { Client } from '@/lib/client'
import type { WorkspaceRootEntry } from '@workspace/contracts'
import { useOpenWorkspaceRoot } from '@/features/workspace/hooks/use-open-root'

import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { toClientError, type ErrorCategory } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { openWorkspaceRootPath } from '@/lib/file-server'
import { claimWorkspaceOpenGeneration } from '@/features/workspace/state/open-generation'

// Categories that prove the cached path can never be a workspace root again.
// Transient failures (io_error, unknown, auth) keep the root so a flaky server
// cannot wipe the user's workspace.
const invalidRootCategories: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'not_found',
  'not_a_directory',
  'invalid_path',
])

// The root folder is restored from a per-browser localStorage cache, so it can
// point at a directory that was deleted or never existed on this machine.
// Validate it against the file server and fall back to the folder picker
// instead of rendering an empty workspace that looks like a broken FS.
export function useValidateRootFolder() {
  const queryClient = useQueryClient()
  const store = useEditorWorkspaceStoreApi()
  const openRoot = useOpenWorkspaceRoot()
  const path = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)

  useEffect(() => {
    if (path === null) return

    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      environmentActivitySignal(originForQueryClient(queryClient)),
    ])
    const generation = claimWorkspaceOpenGeneration()
    const clearWhenStillCurrent = (reason: string) => {
      if (signal.aborted) return
      if (store.getState().rootFolder?.path !== path) return

      log.warn({ action: 'workspace.root_invalid', area: 'workspace', path, reason })
      store.getState().clearRootFolder()
    }
    const confirmWhenStillCurrent = (entry: WorkspaceRootEntry) => {
      if (signal.aborted) return
      const rootFolder = store.getState().rootFolder
      if (!rootFolder || rootFolder.path !== path) return
      if (entry.path !== path) {
        void openRoot(entry.path)
        return
      }
      if (rootFolder.workspaceAddress?.id === entry.workspaceAddress.id) return

      store.setState({ rootFolder: { ...rootFolder, workspaceAddress: entry.workspaceAddress } })
    }

    void validateRootPath(
      path,
      generation,
      signal,
      clearWhenStillCurrent,
      confirmWhenStillCurrent,
      clientForQueryClient(queryClient),
    )
    return () => controller.abort()
  }, [openRoot, path, queryClient, store])
}

async function validateRootPath(
  path: string,
  generation: number,
  signal: AbortSignal,
  clear: (reason: string) => void,
  confirm: (entry: WorkspaceRootEntry) => void,
  client: Client,
) {
  try {
    const result = await openWorkspaceRootPath(path, generation, signal, client)
    if (result.status === 'opened' && result.entry) confirm(result.entry)
  } catch (error) {
    if (signal.aborted) return

    const category = toClientError(error).category
    if (!invalidRootCategories.has(category)) return

    clear(category)
  }
}
