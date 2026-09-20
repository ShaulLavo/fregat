import type { ReactNode } from 'react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { ToolPaneHeader } from '@workspace/ui/patterns/tool-pane-header'

export function PageHeader({
  actions,
  scope,
  search,
  summary,
}: {
  actions?: ReactNode
  scope: ReactNode
  search?: ReactNode
  summary?: ReactNode
}) {
  return (
    <div
      className='shrink-0 @max-3xl/settings:[--bar-height:var(--touch-target-size)] @max-3xl/settings:[--density-control-height-sm:var(--touch-target-size)] @max-3xl/settings:[--density-control-height:var(--touch-target-size)] @max-3xl/settings:[&_input]:text-base'
      data-settings-header=''
    >
      <ToolPaneHeader title='Settings' actions={actions} />
      <div className='grid grid-cols-[auto_minmax(0,1fr)] @max-3xl/settings:grid-cols-1'>
        <PaneBar>{scope}</PaneBar>
        {search ? <PaneBar className='min-w-0'>{search}</PaneBar> : null}
      </div>
      {summary ? <PaneBar>{summary}</PaneBar> : null}
    </div>
  )
}
