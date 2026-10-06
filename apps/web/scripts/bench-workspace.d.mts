import type { EnvironmentId } from '@workspace/contracts'
import type { WorkspaceRootFolder } from '../src/lib/file-system-types'

export function workspaceCacheEntries(
  workspace: {
    readonly environmentId: EnvironmentId
    readonly filePath: string
    readonly rootFolder: WorkspaceRootFolder
  },
  options?: { readonly inert?: boolean },
): Readonly<Record<string, unknown>>
