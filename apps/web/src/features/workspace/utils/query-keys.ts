import type { WorkspaceAddressId } from '@workspace/contracts'
import type { ShellKind } from '@/lib/shell/utils/kind'

export const disabledFileQueryKey = ['file-system', 'file-snapshots', 'disabled'] as const

export const workspaceQueryKeys = {
  rootValidation: (id: WorkspaceAddressId) => ['workspace', 'root-validation', id] as const,
  shellModule: (kind: ShellKind) => ['workspace', 'shell-module', kind] as const,
}
