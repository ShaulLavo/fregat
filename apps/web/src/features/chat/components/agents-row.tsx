import { CaretRightIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { useAgentsStore } from '@/features/chat/state/agents-store'
import {
  chatAgentGroupLabel,
  chatAgentIsWorking,
  type ChatAgentGroup,
} from '@/features/chat/utils/agents'

export function AgentsRow({ group }: { group: ChatAgentGroup }) {
  const open = useAgentsStore((state) => state.open)
  const working = group.agents.some((entry) => chatAgentIsWorking(entry.agent))

  return (
    <Button
      className='text-muted-foreground h-auto max-w-full justify-start gap-2 px-1 py-1 text-xs font-normal tabular-nums'
      variant='ghost'
      onClick={() => open(group.id)}
    >
      {working ? (
        <Spinner size='xs' aria-hidden='true' />
      ) : (
        <UsersThreeIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      )}
      <span className='truncate'>{chatAgentGroupLabel(group)}</span>
      <CaretRightIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
    </Button>
  )
}
