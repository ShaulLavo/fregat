import type { UseQueryResult } from '@tanstack/react-query'
import type { GitPullRequestActivity } from '@workspace/contracts'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { InlineError } from '@/components/inline-error'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

export function DiscussionActivity({
  query,
}: {
  readonly query: UseQueryResult<GitPullRequestActivity>
}) {
  if (query.isPending)
    return (
      <LoadingState label='Loading forge activity'>
        <div className='flex flex-col gap-3'>
          {['Reviews', 'Commits', 'Threads'].map((section) => (
            <section key={section} className='flex flex-col gap-2'>
              <h3 className='text-sm font-semibold'>{section}</h3>
              <div className='bg-muted p-3'>
                <div className='skeleton-sweep h-4 w-24 rounded-md' />
                <div className='skeleton-sweep mt-2 h-8 rounded-md' />
              </div>
            </section>
          ))}
        </div>
      </LoadingState>
    )
  if (query.isError)
    return (
      <InlineError title='Forge pull request activity' message={clientErrorMessage(query.error)} />
    )
  if (query.data.kind === 'unsupported')
    return <p className='text-muted-foreground text-sm'>{query.data.reason}</p>
  const { reviews, commits, threads } = query.data
  return (
    <div
      className='scroll-fade max-h-48 overflow-y-auto overscroll-contain'
      aria-label='Forge activity'
    >
      <h3 className='text-sm font-semibold'>Reviews</h3>
      {reviews.kind === 'unsupported' ? (
        <p className='text-muted-foreground text-xs'>{reviews.reason}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {reviews.items.length === 0 ? (
            <p className='text-muted-foreground text-xs'>No reviews</p>
          ) : null}
          {reviews.items.map((review) => (
            <article key={review.id} className='bg-muted p-3'>
              <p className='text-xs font-medium'>
                {review.author} · {review.state}
              </p>
              <p className='text-muted-foreground font-mono text-xs'>{review.createdAt}</p>
              <p className='text-sm break-words whitespace-pre-wrap'>{review.body}</p>
            </article>
          ))}
          {reviews.truncated ? (
            <p className='text-muted-foreground text-xs'>
              Open the Git host for the full review history.
            </p>
          ) : null}
        </div>
      )}
      <h3 className='mt-3 text-sm font-semibold'>Commits</h3>
      {commits.kind === 'unsupported' ? (
        <p className='text-muted-foreground text-xs'>{commits.reason}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {commits.items.length === 0 ? (
            <p className='text-muted-foreground text-xs'>No commits</p>
          ) : null}
          {commits.items.map((commit) => (
            <article key={commit.oid} className='bg-muted p-3'>
              <p className='font-mono text-xs' title={commit.oid}>
                {commit.oid.slice(0, 8)} · {commit.author}
              </p>
              <p className='text-muted-foreground font-mono text-xs'>{commit.createdAt}</p>
              <p className='text-sm break-words whitespace-pre-wrap'>{commit.message}</p>
            </article>
          ))}
          {commits.truncated ? (
            <p className='text-muted-foreground text-xs'>
              Open the Git host for all pull request commits.
            </p>
          ) : null}
        </div>
      )}
      <h3 className='mt-3 text-sm font-semibold'>Threads</h3>
      {threads.kind === 'unsupported' ? (
        <p className='text-muted-foreground text-xs'>{threads.reason}</p>
      ) : (
        <div className='flex flex-col gap-2'>
          {threads.items.length === 0 ? (
            <p className='text-muted-foreground text-xs'>No threads</p>
          ) : null}
          {threads.items.map((thread) => (
            <section key={thread.id} className='bg-muted p-3' aria-label={`Thread ${thread.id}`}>
              <p className='text-muted-foreground font-mono text-xs break-words'>
                Thread #{thread.id}
                {thread.path ? ` · ${thread.path}` : ''}
              </p>
              {thread.comments.map((comment) => (
                <article key={comment.id} className='mt-2'>
                  <p className='text-xs font-medium'>{comment.author}</p>
                  <p className='text-sm break-words whitespace-pre-wrap'>{comment.body}</p>
                </article>
              ))}
            </section>
          ))}
          {threads.truncated ? (
            <p className='text-muted-foreground text-xs'>
              Open the Git host for all conversation threads.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
