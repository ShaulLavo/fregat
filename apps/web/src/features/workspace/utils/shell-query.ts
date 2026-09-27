import { queryOptions } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { ShellKind } from '@/lib/shell/utils/kind'
import { workspaceQueryKeys } from '@/features/workspace/utils/query-keys'
import { WorkbenchShell } from '@/features/workspace/components/workbench-shell'

export type ShellView = ComponentType<{ readonly rootPath: FilesystemPath }>

/**
 * The phone shell is its own chunk, so a desktop never downloads it. The workbench stays in the
 * entry: splitting it out fragments its closure into dozens of chunks that gzip worse than one,
 * which grows the desktop's first load by more than the phone would save.
 */
export function shellQueryOptions(kind: ShellKind) {
  return queryOptions({
    queryKey: workspaceQueryKeys.shellModule(kind),
    queryFn: (): Promise<ShellView> =>
      kind === 'phone'
        ? import('@/features/phone/components/shell').then((module) => module.PhoneShell)
        : Promise.resolve(WorkbenchShell),
    staleTime: 'static',
    structuralSharing: false,
    gcTime: Infinity,
    // The browser may already have the chunk while offline.
    networkMode: 'always',
  })
}
