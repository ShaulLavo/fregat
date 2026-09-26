import { ToolPane } from '@workspace/ui/patterns/tool-pane'

import { SessionTerminal } from '@/features/chat-mode/components/session-terminal'
import { Header } from '@/features/phone/components/header'

/** The session's shell: the same PTY the desk has open. */
export function TerminalScreen() {
  return (
    <ToolPane
      className='h-full min-w-0 overflow-hidden'
      bodyClassName='bg-content-well'
      scroll={false}
      header={<Header title='Terminal' />}
    >
      <SessionTerminal />
    </ToolPane>
  )
}
