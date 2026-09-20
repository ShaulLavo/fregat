import { ArrowRightIcon, ArrowSquareOutIcon, PencilSimpleIcon } from '@phosphor-icons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'

import { usePlanFollowUp } from '@/features/chat/hooks/use-plan-follow-up'
import { proposedPlanTitle } from '@workspace/client-core/chat/proposed-plan'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

/**
 * The payoff of plan mode: a finished plan gets acted on from where the user
 * already is, instead of being re-authorised by typing "go ahead".
 *
 * The empty composer is the affordance. Nothing typed means the plan stands as
 * written, so the action implements it; anything typed is feedback, so the same
 * action refines the plan instead. The draft is read straight from its store —
 * routing it through props would make this banner a second owner of composer
 * state that the composer would then have to keep in sync.
 *
 * Splitting the build into its own session is offered only alongside Implement.
 * Typed feedback is a request for a better plan, and there is nothing to build
 * elsewhere until that plan comes back.
 */
export function PlanFollowUpBanner({
  draftTarget,
}: {
  readonly draftTarget: ChatInputDraftTarget
}) {
  const { disabledReason, implementInNewSession, plan, submitFollowUp, submitting } =
    usePlanFollowUp()
  const draftText = useChatInputDraftStore((state) => state.getDraft(draftTarget).prompt)
  if (!plan) return null

  const refining = draftText.trim().length > 0
  const ActionIcon = refining ? PencilSimpleIcon : ArrowRightIcon

  return (
    <div
      aria-label='Plan ready'
      className='shrink-0 px-(--density-control-padding-x) pt-(--density-control-padding-x)'
      role='status'
    >
      <div
        className='bg-info/10 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-(--density-control-gap) rounded-lg px-(--density-control-padding-x) py-(--density-section-gap)'
        title={proposedPlanTitle(plan.planMarkdown)}
      >
        <Badge className='border-info/40 text-info uppercase' variant='outline'>
          Plan ready
        </Badge>
        <p className='text-foreground min-w-0 flex-1 truncate text-sm font-medium'>
          {proposedPlanTitle(plan.planMarkdown)}
        </p>
        {refining ? null : (
          <Button
            aria-label='Implement in a new session'
            disabled={submitting || disabledReason !== null}
            title={disabledReason ?? undefined}
            size='sm'
            type='button'
            variant='outline'
            onClick={() => void implementInNewSession()}
          >
            <ArrowSquareOutIcon className='size-(--icon-size-sm)' />
            New session
          </Button>
        )}
        <Button
          disabled={submitting || disabledReason !== null}
          title={disabledReason ?? undefined}
          size='sm'
          type='button'
          onClick={() => void submitFollowUp()}
        >
          {submitting ? (
            <OrbitLoader className='size-3.5' />
          ) : (
            <ActionIcon className='size-(--icon-size-sm)' />
          )}
          {refining ? 'Refine' : 'Implement'}
        </Button>
      </div>
    </div>
  )
}
