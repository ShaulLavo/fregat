import type { GitPullRequestReviewVerdict } from '@workspace/contracts'
import { useSubmitPullRequestReview } from '@/features/git/hooks/use-submit-pull-request-review'
import { ReviewComposer } from '@/features/git/components/review-composer'
import { usePullRequestActivity } from '@/features/git/hooks/use-pull-request-activity'
import { DiscussionActivity } from '@/features/git/components/discussion-activity'
import { DiscussionComments } from '@/features/git/components/discussion-comments'
import { useId, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@workspace/ui/components/tabs'
import { Textarea } from '@workspace/ui/components/textarea'
import { Spinner } from '@workspace/ui/components/spinner'
import { InlineError } from '@/components/inline-error'
import { DialogField } from '@/features/git/components/dialog-field'
import { usePullRequestComments } from '@/features/git/hooks/use-pull-request-comments'
import { usePostPullRequestComment } from '@/features/git/hooks/use-post-pull-request-comment'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

export function DiscussionDialog({
  rootPath,
  number,
  url,
  open,
  onOpenChange,
}: {
  readonly rootPath: string
  readonly number: number
  readonly url: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const subject = JSON.stringify([rootPath, number])
  const [draft, setDraft] = useState({ subject, body: '' })
  const [reviewDraft, setReviewDraft] = useState({ subject, body: '' })
  const [submissionSubject, setSubmissionSubject] = useState<string | null>(null)
  const reviewBody = reviewDraft.subject === subject ? reviewDraft.body : ''
  const review = useSubmitPullRequestReview(rootPath, number)
  const body = draft.subject === subject ? draft.body : ''
  const setBody = (body: string) => setDraft({ subject, body })
  const id = useId()
  const comments = usePullRequestComments(rootPath, number, open)
  const activity = usePullRequestActivity(rootPath, number, open)
  const post = usePostPullRequestComment(rootPath, number)
  const ready =
    comments.data?.kind === 'ready' &&
    comments.data.comment.kind === 'supported' &&
    body.trim().length > 0 &&
    !post.isPending

  function submit() {
    if (!ready) return
    post.mutate(body, {
      onSuccess: (result) => {
        if (result.kind !== 'posted') return
        setDraft((current) =>
          current.subject === subject && current.body === body ? { subject, body: '' } : current,
        )
      },
    })
  }

  function submitReview(verdict: GitPullRequestReviewVerdict) {
    const capability = comments.data?.kind === 'ready' ? comments.data.review : undefined
    if (
      review.isPending ||
      capability?.kind !== 'supported' ||
      !capability.verdicts.includes(verdict)
    )
      return
    if (verdict !== 'approve' && !reviewBody.trim()) return
    setSubmissionSubject(subject)
    review.mutate(
      { verdict, body: reviewBody },
      {
        onSuccess: (result) => {
          if (result.kind !== 'submitted') return
          setReviewDraft((value) =>
            value.subject === subject && value.body === reviewBody ? { subject, body: '' } : value,
          )
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='scroll-fade scroll-gutter max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto overscroll-contain'>
        <DialogHeader>
          <DialogTitle>Pull request #{number} discussion</DialogTitle>
          <DialogDescription>
            Read discussion and submit comments and reviews on the Git host.
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='ghost'
            disabled={comments.isFetching || activity.isFetching}
            onClick={() => void Promise.all([comments.refetch(), activity.refetch()])}
          >
            Refresh discussion
          </Button>
          {comments.isFetching || activity.isFetching ? (
            <Spinner size='xs' label='Refreshing discussion' />
          ) : null}
          <a
            href={url}
            target='_blank'
            rel='noreferrer'
            className='text-muted-foreground text-xs underline'
          >
            Open on Git host
          </a>
        </div>
        <Tabs defaultValue='comments'>
          <TabsList variant='segmented' aria-label='Pull request discussion view'>
            <TabsTab value='comments'>Comments</TabsTab>
            <TabsTab value='activity'>Activity</TabsTab>
          </TabsList>
          <TabsPanel value='comments'>
            <DiscussionComments query={comments} />
          </TabsPanel>
          <TabsPanel value='activity'>
            <DiscussionActivity query={activity} />
          </TabsPanel>
        </Tabs>
        {comments.data?.kind === 'ready' && comments.data.comment.kind === 'unsupported' ? (
          <p className='text-muted-foreground text-sm'>{comments.data.comment.reason}</p>
        ) : null}
        {comments.data?.kind === 'ready' && comments.data.comment.kind === 'supported' ? (
          <form
            className='flex flex-col gap-3'
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <DialogField id={id} label='Comment'>
              <Textarea
                id={id}
                disabled={post.isPending}
                value={body}
                maxLength={60_000}
                onChange={(event) => setBody(event.currentTarget.value)}
                placeholder='Write a comment for the pull request'
              />
            </DialogField>
            {post.isError ? <InlineError message={clientErrorMessage(post.error)} /> : null}
            {post.data?.kind === 'unsupported' ? (
              <p className='text-muted-foreground text-sm'>{post.data.reason}</p>
            ) : null}
            <DialogFooter>
              <Button type='submit' disabled={!ready}>
                {post.isPending ? 'Posting comment…' : 'Post comment'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
        {comments.data?.kind === 'ready' ? (
          <ReviewComposer
            capability={comments.data.review}
            body={reviewBody}
            onBodyChange={(body) => setReviewDraft({ subject, body })}
            onSubmit={submitReview}
            review={review}
            current={submissionSubject === subject}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
