import { queryOptions } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { ShellKind } from '@/lib/shell/utils/kind'
import { workspaceQueryKeys } from '@/features/workspace/utils/query-keys'

export type ShellView = ComponentType<{ readonly rootPath: FilesystemPath }>

/**
 * Each shell is its own chunk, so a desktop never downloads the phone shell and a phone never
 * downloads the workbench. The boot script preloads the chosen one beside the entry script.
 */
export function shellQueryOptions(kind: ShellKind) {
  return queryOptions({
    queryKey: workspaceQueryKeys.shellModule(kind),
    queryFn: (): Promise<ShellView> =>
      kind === 'phone'
        ? import('@/features/phone/components/shell').then((module) => module.PhoneShell)
        : import('@/features/workspace/components/workbench-shell').then(
            (module) => module.WorkbenchShell,
          ),
    staleTime: 'static',
    structuralSharing: false,
    gcTime: Infinity,
    // The browser may already have the chunk while offline.
    networkMode: 'always',
  })
}
