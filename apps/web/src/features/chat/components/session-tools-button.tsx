import { PlugsIcon } from '@phosphor-icons/react'
import type { ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { SessionHooksList } from '@/features/chat/components/session-hooks-list'
import { SessionMcpList } from '@/features/chat/components/session-mcp-list'
import { useSessionHooks } from '@/features/chat/hooks/use-session-hooks'
import { useSessionMcp } from '@/features/chat/hooks/use-session-mcp'

/** The session's MCP servers and configured hooks, read from its live provider. */
export function SessionToolsButton({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const [open, setOpen] = useState(false)
  const mcp = useSessionMcp(sessionRef, open)
  const hooks = useSessionHooks(sessionRef, open)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label='MCP servers and hooks'
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <PlugsIcon className='size-(--icon-size)' />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{'MCP servers and hooks'}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80 p-0 pb-(--density-popover-padding) text-xs'>
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          MCP servers
        </p>
        <SessionMcpList mcp={mcp} sessionRef={sessionRef} />
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          Hooks
        </p>
        <SessionHooksList hooks={hooks} />
      </PopoverContent>
    </Popover>
  )
}
