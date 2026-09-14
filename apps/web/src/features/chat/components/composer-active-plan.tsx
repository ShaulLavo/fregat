import { CaretRightIcon, CheckIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'

import type { ChatWorkLogPlan } from '@/features/chat/utils/work-log'

export function ComposerActivePlan({
  plan,
  separated,
}: {
  plan: ChatWorkLogPlan
  separated: boolean
}) {
  return (
    <Collapsible className={cn('group/plan', separated && 'border-subtle border-t')}>
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
          className='size-3 shrink-0 group-data-[open]/plan:rotate-90'
        />
        <span className='shrink-0 tabular-nums' aria-label='Plan progress'>
          {plan.completedCount}/{plan.steps.length}
        </span>
        <span className='truncate'>
          {plan.currentStep ??
            (plan.completedCount === plan.steps.length ? 'Plan complete' : 'Plan')}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol
          aria-label='Plan steps'
          className='max-h-48 space-y-1 overflow-auto overscroll-contain px-3 pb-2'
          data-tool-group-scroll
        >
          {plan.steps.map((step, index) => (
            <li className='text-2xs flex items-start gap-2 leading-5' key={`${index}:${step.step}`}>
              {step.status === 'completed' ? (
                <CheckIcon aria-label='Completed' className='text-success mt-1 size-3 shrink-0' />
              ) : null}
              {step.status !== 'completed' ? (
                <span
                  aria-label={step.status === 'inProgress' ? 'In progress' : 'Pending'}
                  className={cn(
                    'border-border mt-1.5 size-2 shrink-0 rounded-full border',
                    step.status === 'inProgress' && 'border-info bg-info',
                  )}
                />
              ) : null}
              <span
                className={cn(
                  'text-muted-foreground',
                  step.status === 'inProgress' && 'text-foreground',
                  step.status === 'completed' && 'line-through',
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
