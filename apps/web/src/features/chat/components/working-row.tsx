import type { OrchestrationLatestTurn } from '@workspace/contracts'
import { TurnStatusFrame } from '@/features/chat/components/turn-status-frame'
import { WorkingTimer } from '@/features/chat/components/working-timer'

export function WorkingRow({
  latestTurn,
  startedAt,
}: {
  latestTurn: OrchestrationLatestTurn
  startedAt: string
}) {
  return (
    <TurnStatusFrame>
      <p className='px-1'>
        {latestTurn.sourceProposedPlan ? 'Working from plan for ' : 'Working for '}
        <WorkingTimer startedAt={startedAt} />
      </p>
    </TurnStatusFrame>
  )
}
