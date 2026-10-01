import { useId } from 'react'
import type {
  GitPullRequestReviewCapability,
  GitPullRequestReviewVerdict,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'
import { InlineError } from '@/components/inline-error'
import { DialogField } from '@/features/git/components/dialog-field'
import type { useSubmitPullRequestReview } from '@/features/git/hooks/use-submit-pull-request-review'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

const labels = {
  comment: 'Submit review',
  approve: 'Approve pull request',
  'request-changes': 'Request changes',
} as const

export function ReviewComposer({
  capability,
  body,
  onBodyChange,
  onSubmit,
  review,
  current,
}: {
  readonly capability: GitPullRequestReviewCapability
  readonly body: string
  readonly onBodyChange: (body: string) => void
  readonly onSubmit: (verdict: GitPullRequestReviewVerdict) => void
  readonly review: ReturnType<typeof useSubmitPullRequestReview>
  readonly current: boolean
}) {
  const id = useId()
  const pending = current && review.isPending

  if (capability.kind === 'unsupported')
    return <p className='text-muted-foreground text-sm'>{capability.reason}</p>

  return (
    <section className='flex flex-col gap-3' aria-label='Forge review'>
      <h3 className='text-sm font-semibold'>Review</h3>
      <DialogField id={id} label='Review summary'>
        <Textarea
          id={id}
          value={body}
          disabled={pending}
          rows={2}
          maxLength={60_000}
          onChange={(event) => onBodyChange(event.currentTarget.value)}
          placeholder='Summarize your review for the Git host'
        />
      </DialogField>
      {current && review.isError ? (
        <InlineError message={clientErrorMessage(review.error)} />
      ) : null}
      {current && review.data?.kind === 'unsupported' ? (
        <p className='text-muted-foreground text-sm'>{review.data.reason}</p>
      ) : null}
      {current && review.data?.kind === 'submitted' ? (
        <p role='status' className='text-muted-foreground text-sm'>
          Review submitted
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {capability.verdicts.map((verdict) => (
          <Button
            key={verdict}
            size='sm'
            variant='outline'
            disabled={pending || (verdict !== 'approve' && !body.trim())}
            onClick={() => onSubmit(verdict)}
          >
            {pending && review.variables?.verdict === verdict
              ? 'Submitting review…'
              : labels[verdict]}
          </Button>
        ))}
      </div>
    </section>
  )
}
