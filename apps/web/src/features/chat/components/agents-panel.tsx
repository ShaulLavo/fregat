import type { OrchestrationSessionActivity } from '@workspace/contracts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { AgentRow } from '@/features/chat/components/agent-row'
import { useAgentsStore } from '@/features/chat/state/agents-store'
import { chatAgentGroups, chatAgentGroupLabel } from '@/features/chat/utils/agents'

export function AgentsPanel({
  activities,
}: {
  activities: readonly OrchestrationSessionActivity[]
}) {
  const selectedGroupId = useAgentsStore((state) => state.selectedGroupId)
  const close = useAgentsStore((state) => state.close)
  const group = chatAgentGroups(activities).find((entry) => entry.id === selectedGroupId)

  return (
    <Dialog
      disablePointerDismissal
      modal={false}
      open={group !== undefined}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className='flex flex-col gap-0' overlayClassName='hidden' side='right'>
        <DialogHeader className='border-border border-b pb-4'>
          <DialogTitle>Agents</DialogTitle>
          <DialogDescription>
            {group ? chatAgentGroupLabel(group) : 'Agent activity'}
          </DialogDescription>
        </DialogHeader>
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-y-contain pt-2'>
          {group?.agents.map((entry) => (
            <AgentRow entry={entry} groupId={group.id} key={entry.agent.threadId} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
