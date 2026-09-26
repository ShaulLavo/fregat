import type { ShellKind } from '@/lib/shell/utils/kind'

export const disabledFileQueryKey = ['file-system', 'file-snapshots', 'disabled'] as const

export const workspaceQueryKeys = {
  shellModule: (kind: ShellKind) => ['workspace', 'shell-module', kind] as const,
}
