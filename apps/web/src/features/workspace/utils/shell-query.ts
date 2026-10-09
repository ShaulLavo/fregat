import { queryOptions } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import type { ShellProps } from '@/lib/shell/utils/props'
import type { ShellKind } from '@/lib/shell/utils/kind'
import { workspaceQueryKeys } from '@/features/workspace/utils/query-keys'

type ShellView = ComponentType<ShellProps>

/**
 * Each shell is its own chunk, so a desktop never downloads the phone shell and a phone never
 * downloads the workbench. The boot script preloads the chosen one beside the entry script.
 */
export function shellQueryOptions(kind: ShellKind) {
  return queryOptions({
    queryKey: workspaceQueryKeys.shellModule(kind),
    queryFn: kind === 'phone' ? loadPhone : loadWorkbench,
    staleTime: 'static',
    structuralSharing: false,
    gcTime: Infinity,
    // The browser may already have the chunk while offline.
    networkMode: 'always',
  })
}

// Separate functions keep Vite from merging both imports into one preload dependency list.
function loadPhone(): Promise<ShellView> {
  return import('@/features/phone/components/shell').then((module) => module.PhoneShell)
}

function loadWorkbench(): Promise<ShellView> {
  return import('@/features/workspace/components/workbench-shell').then(
    (module) => module.WorkbenchShell,
  )
}
