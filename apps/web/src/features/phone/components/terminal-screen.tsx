import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useRef } from 'react'

import { SessionTerminal } from '@/features/chat-mode/components/session-terminal'
import { Header } from '@/features/phone/components/header'
import { TerminalKeys } from '@/features/phone/components/terminal-keys'

/** The session's shell: the same PTY the desk has open, with the keys a touch keyboard lacks. */
export function TerminalScreen() {
  const terminalRef = useRef<HTMLDivElement>(null)

  return (
    <section aria-label='Terminal' className='flex h-full min-h-0 flex-col'>
      <ToolPane
        className='min-h-0 min-w-0 flex-1 overflow-hidden'
        bodyClassName='bg-content-well'
        bodyProps={{ ref: terminalRef }}
        scroll={false}
        header={<Header title='Terminal' />}
      >
        <SessionTerminal />
      </ToolPane>
      <TerminalKeys terminalRef={terminalRef} />
    </section>
  )
}
