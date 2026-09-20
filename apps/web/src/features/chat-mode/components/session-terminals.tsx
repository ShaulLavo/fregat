import { ToolPane as PaneShell } from '@workspace/ui/patterns/tool-pane'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { cn } from '@workspace/ui/lib/utils'

import { ToolPaneHeader } from '@/components/tool-pane-header'
import type { OpenedTerminal } from '@/features/chat-mode/hooks/use-opened-terminals'
import { TerminalPanel } from '@/features/terminal/components/panel'

export function SessionTerminals({
  activeId,
  terminals,
  visible,
}: {
  readonly activeId: string
  readonly terminals: readonly OpenedTerminal[]
  /** False while another tool covers the pane or the pane is collapsed. */
  readonly visible: boolean
}) {
  return (
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='relative bg-content-well overflow-hidden'
      header={<ToolPaneHeader tab='terminal' />}
    >
      {terminals.map((terminal) => {
        const selected = terminal.id === activeId
        return (
          // Hidden, never unmounted: a remount reconnects and replays scrollback.
          <div
            className={cn('absolute inset-0', !selected && 'invisible')}
            inert={!selected}
            key={terminal.id}
          >
            <RenderErrorBoundary label='Terminal'>
              <TerminalPanel
                active={visible && selected}
                className='h-full'
                rootPath={terminal.rootPath}
                sessionId={terminal.id}
              />
            </RenderErrorBoundary>
          </div>
        )
      })}
    </PaneShell>
  )
}
