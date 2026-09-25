import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { PlanStepMark } from '@/features/chat/components/plan-step-mark'
import { planStepKeys, planTriggerLabel } from '@/features/chat/utils/plan-steps'
import type { ChatWorkLogPlan } from '@/features/chat/utils/work-log'

export function ComposerActivePlan({ plan }: { plan: ChatWorkLogPlan }) {
  const complete = plan.liveCount > 0 && plan.completedCount === plan.liveCount
  const keys = planStepKeys(plan.steps)
  const [open, setOpen] = useState(false)
  const [foldedWhenComplete, setFoldedWhenComplete] = useState(false)
  const [seenComplete, setSeenComplete] = useState(complete)
  // Folds itself when the last step completes, and reopens if one goes back.
  if (seenComplete !== complete) {
    setSeenComplete(complete)
    if (complete && open) setFoldedWhenComplete(true)
    if (complete) setOpen(false)
    if (!complete && foldedWhenComplete) {
      setOpen(true)
      setFoldedWhenComplete(false)
    }
  }

  return (
    <Collapsible className='group/plan' open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            className='text-muted-foreground text-2xs h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal'
            variant='ghost'
          />
        }
        title={plan.currentStep ?? undefined}
      >
        <CaretRightIcon
          aria-hidden='true'
          className='size-(--icon-size-sm) shrink-0 group-data-[open]/plan:rotate-90'
        />
        <span className='shrink-0 font-mono tabular-nums' aria-label='Plan progress'>
          {plan.completedCount}/{plan.liveCount}
        </span>
        <span className='truncate'>{planTriggerLabel(plan, complete)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol
          aria-label='Plan steps'
          className='max-h-48 space-y-1 overflow-auto overscroll-contain px-3 pb-2'
          data-tool-group-scroll
        >
          {plan.steps.map((step, index) => (
            <li
              className='text-2xs flex items-center gap-2 leading-5'
              data-plan-step-status={step.status}
              key={keys[index]}
            >
              <PlanStepMark status={step.status} />
              <span
                className={cn(
                  'text-muted-foreground',
                  step.status === 'inProgress' && 'text-foreground',
                  step.status === 'dropped' && 'line-through',
                )}
              >
                {step.step}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
