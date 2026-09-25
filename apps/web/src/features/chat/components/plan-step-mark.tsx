import { Spinner } from '@workspace/ui/components/spinner'

import { planStepLabel, type ChatPlanStep } from '@/features/chat/utils/plan-steps'

/** A drawn status: dashed ring pending, spinner running, check done, dash dropped. */
export function PlanStepMark({ status }: { status: ChatPlanStep['status'] }) {
  if (status === 'inProgress') return <Spinner label={planStepLabel(status)} size='xs' />

  return (
    <svg
      aria-label={planStepLabel(status)}
      className='text-muted-foreground size-(--icon-size-sm) shrink-0'
      data-plan-step-mark={status}
      fill='none'
      role='img'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={1.5}
      viewBox='0 0 16 16'
    >
      {status === 'pending' ? <circle cx='8' cy='8' r='5.5' strokeDasharray='2.2 2.2' /> : null}
      {status === 'dropped' ? <path d='M5 8h6' /> : null}
      {status === 'completed' ? (
        <path
          className='text-success transition-[stroke-dashoffset] [stroke-dashoffset:0] motion-reduce:transition-none starting:[stroke-dashoffset:1]'
          d='M3.5 8.5l3 3 6-7'
          pathLength={1}
          strokeDasharray='1'
        />
      ) : null}
    </svg>
  )
}
