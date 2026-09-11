import type { OrchestrationLatestTurn } from '@workspace/contracts'
import { WorkingTimer } from '@/features/chat/components/working-timer'

export function WorkingRow({
  latestTurn,
  startedAt,
}: {
  latestTurn: OrchestrationLatestTurn
  startedAt: string
}) {
  return (
    <div className='border-border/60 text-muted-foreground border-b px-1 pt-1 pb-2 text-xs tabular-nums'>
      {latestTurn.sourceProposedPlan ? 'Working from plan for ' : 'Working for '}
      <WorkingTimer startedAt={startedAt} />
    </div>
  )
}
