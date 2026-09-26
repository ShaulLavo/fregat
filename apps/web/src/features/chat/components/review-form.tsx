import type { AgentReviewTarget, SessionId } from '@workspace/contracts'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { useState } from 'react'

import {
  REVIEW_TARGET_OPTIONS,
  reviewerOptions,
  type ReviewTargetKind,
} from '@/features/chat/utils/reviewer-options'
import { providerListQueryOptions } from '@/lib/provider-query'

/** What to review and who reviews it; `onStart` gets both once they are complete. */
export function ReviewForm({
  busy,
  onStart,
  sessionId,
}: {
  readonly busy: boolean
  readonly onStart: (input: {
    readonly target: AgentReviewTarget
    readonly reviewer: ReturnType<typeof reviewerOptions>[number]['selection']
  }) => void
  readonly sessionId: SessionId
}) {
  const providers = useQuery(providerListQueryOptions())
  const options = reviewerOptions(providers.data?.providers ?? [])
  const [kind, setKind] = useState<ReviewTargetKind>('turn')
  const [reviewerValue, setReviewerValue] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const reviewer = options.find((option) => option.value === reviewerValue) ?? options[0] ?? null
  const target = reviewTarget(kind, reference.trim(), sessionId)

  return (
    <form
      className='flex flex-col gap-(--density-gap-tight) p-(--density-popover-padding)'
      onSubmit={(event) => {
        event.preventDefault()
        if (target && reviewer) onStart({ target, reviewer: reviewer.selection })
      }}
    >
      <Select
        items={REVIEW_TARGET_OPTIONS}
        value={kind}
        onValueChange={(next) => next && setKind(next)}
      >
        <SelectTrigger aria-label='Changes to review' size='sm'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REVIEW_TARGET_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {kind === 'branch' || kind === 'commit' ? (
        <Input
          aria-label={kind === 'branch' ? 'Base branch' : 'Commit hash'}
          className='font-mono text-xs'
          placeholder={kind === 'branch' ? 'main' : 'Commit hash'}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      ) : null}
      <Select
        items={options}
        value={reviewer?.value ?? null}
        onValueChange={(next) => setReviewerValue(next)}
      >
        <SelectTrigger aria-label='Reviewer' size='sm' title={reviewer?.label}>
          <SelectValue placeholder='No ready provider' />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={busy || !target || !reviewer} size='sm' type='submit'>
        {busy ? 'Reviewing…' : 'Start review'}
      </Button>
    </form>
  )
}

function reviewTarget(
  kind: ReviewTargetKind,
  reference: string,
  sessionId: SessionId,
): AgentReviewTarget | null {
  if (kind === 'turn') return { kind, sessionId }
  if (kind === 'uncommitted') return { kind }
  if (!reference) return null
  if (kind === 'branch') return { kind, baseBranch: reference }
  return /^[0-9a-f]{4,64}$/i.test(reference) ? { kind, sha: reference } : null
}
