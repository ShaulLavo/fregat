import { Spinner } from '@workspace/ui/components/spinner'
import { BranchChip } from '@/features/git/components/branch-chip'
import { RemoteActions } from '@/features/git/components/remote-actions'
import { ToolPaneHeader } from '@/components/tool-pane-header'

export function GitPaneHeader({
  rootPath,
  loading = false,
}: {
  readonly rootPath: string
  readonly loading?: boolean
}) {
  return (
    <ToolPaneHeader
      actions={
        <>
          {loading ? <Spinner label='Loading Git' size='xs' /> : null}
          <RemoteActions rootPath={rootPath} />
        </>
      }
      detail={<BranchChip rootPath={rootPath} />}
      tab='git'
    />
  )
}
