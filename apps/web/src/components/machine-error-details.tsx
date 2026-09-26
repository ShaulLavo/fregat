import type { ConnectionError } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover'

import { FixWithAgentButton } from '@/components/fix-with-agent-button'

export function MachineErrorDetails({ label, error }: { label: string; error: ConnectionError }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} connection details`}
        render={<Button size='xs' variant='ghost' />}
      >
        Details
      </PopoverTrigger>
      <PopoverContent align='start' className='max-w-[calc(100vw-2rem)]'>
        <PopoverTitle>{label} connection</PopoverTitle>
        <PopoverDescription className='max-h-60 overflow-auto overscroll-contain wrap-anywhere whitespace-pre-wrap'>
          {error.message}
        </PopoverDescription>
        {error.why ? (
          <p className='text-muted-foreground text-xs wrap-anywhere'>{error.why}</p>
        ) : null}
        {error.fix ? <p className='text-xs wrap-anywhere'>{error.fix}</p> : null}
        <p className='text-muted-foreground text-xs'>
          Manage this connection in Settings → Machines.
        </p>
        <FixWithAgentButton error={{ ...error, title: `${label} connection` }} />
      </PopoverContent>
    </Popover>
  )
}
