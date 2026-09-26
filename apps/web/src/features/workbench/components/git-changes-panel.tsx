import { useStatus } from '@/features/git/hooks/use-status'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { Panel as GitPanel } from '@/features/git/components/panel'
import { GitPaneHeader } from '@/features/workbench/components/git-pane-header'

export function GitChangesPanel({ rootPath: selectedRoot }: { readonly rootPath: FilesystemPath }) {
  const nextStatus = useStatus(selectedRoot)
  const rootPath = useHeldUntilReady(selectedRoot, !nextStatus.isPending)
  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <GitPaneHeader rootPath={rootPath} loading={rootPath !== selectedRoot} />
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <GitPanel rootPath={rootPath} />
      </div>
    </section>
  )
}
