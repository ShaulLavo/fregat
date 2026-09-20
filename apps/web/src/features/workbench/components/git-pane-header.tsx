import { BranchChip } from '@/features/git/components/branch-chip'
import { RemoteActions } from '@/features/git/components/remote-actions'
import { ToolPaneHeader } from '@/components/tool-pane-header'

export function GitPaneHeader({ rootPath }: { readonly rootPath: string }) {
  return (
    <ToolPaneHeader
      actions={<RemoteActions rootPath={rootPath} />}
      detail={<BranchChip rootPath={rootPath} />}
      tab='git'
    />
  )
}
