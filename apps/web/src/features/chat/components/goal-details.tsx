import type { ProviderSessionGoal } from '@workspace/contracts'
import { ValueGrid, ValueGridRow } from '@workspace/ui/components/value-grid'

import { formatChatDuration } from '@/features/chat/utils/formatters'
import { goalStatusLabel, goalTokensLabel } from '@/features/chat/utils/goal-labels'

/** The objective, then what the harness reported about the work toward it. */
export function GoalDetails({ goal }: { readonly goal: ProviderSessionGoal }) {
  const tokens = goalTokensLabel(goal)
  return (
    <div className='flex flex-col gap-(--density-gap-tight) px-(--density-row-padding-x)'>
      <p className='text-foreground text-xs whitespace-pre-wrap'>{goal.objective}</p>
      <ValueGrid>
        <ValueGridRow label='Status' value={goalStatusLabel(goal.status)} />
        {tokens ? <ValueGridRow label='Tokens' value={tokens} /> : null}
        {goal.timeUsedSeconds === null ? null : (
          <ValueGridRow label='Time' value={formatChatDuration(goal.timeUsedSeconds * 1000)} />
        )}
        {goal.iterations === null ? null : <ValueGridRow label='Checks' value={goal.iterations} />}
        {goal.lastReason ? (
          <ValueGridRow label='Last check' title={goal.lastReason} value={goal.lastReason} />
        ) : null}
      </ValueGrid>
    </div>
  )
}
