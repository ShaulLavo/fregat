import type { MutationOptions } from '@tanstack/react-query'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { openWorkspaceRootPath } from '@/lib/file-server'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'

export type OpenWorkspaceRootVariables = {
  readonly signal: AbortSignal
}

export function openWorkspaceRootMutationOptions(
  path: FilesystemPath,
): MutationOptions<
  Awaited<ReturnType<typeof openWorkspaceRootPath>>,
  unknown,
  OpenWorkspaceRootVariables
> {
  return {
    mutationFn: ({ signal }, { client }) =>
      openWorkspaceRootPath(path, signal, clientForQueryClient(client)),
    mutationKey: workspaceMutationKeys.openRoot(path),
  }
}
