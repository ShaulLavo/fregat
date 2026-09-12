import type { FilesystemPath } from '@/lib/documents/utils/types'
import { Panel as GitPanel } from '@/features/git/components/panel'
import { ToolPaneHeader } from '@/features/workbench/components/tool-pane-header'

export function GitChangesPanel({ rootPath }: { readonly rootPath: FilesystemPath }) {
  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <ToolPaneHeader tab='git' />
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <GitPanel rootPath={rootPath} />
      </div>
    </section>
  )
}
