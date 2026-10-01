import type { UseQueryResult } from '@tanstack/react-query'
import type { GitPullRequestComments } from '@workspace/contracts'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { InlineError } from '@/components/inline-error'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

export function DiscussionComments({
  query,
}: {
  readonly query: UseQueryResult<GitPullRequestComments>
}) {
  if (query.isPending)
    return (
      <LoadingState label='Loading discussion'>
        <div className='bg-muted p-3'>
          <div className='skeleton-sweep h-4 w-24 rounded-md' />
          <div className='skeleton-sweep mt-2 h-8 rounded-md' />
        </div>
      </LoadingState>
    )
  if (query.isError) return <InlineError message={clientErrorMessage(query.error)} />
  if (query.data.kind === 'unsupported')
    return <p className='text-muted-foreground text-sm'>{query.data.reason}</p>
  return (
    <div
      className='scroll-fade max-h-64 overflow-y-auto overscroll-contain'
      aria-label='Forge comments'
    >
      {query.data.comments.length === 0 ? (
        <p className='text-muted-foreground text-sm'>No comments</p>
      ) : null}
      {query.data.comments.map((comment) => (
        <article key={comment.id} className='bg-muted mb-3 p-3'>
          <p className='text-xs font-medium'>{comment.author}</p>
          {comment.context ? (
            <p className='text-muted-foreground font-mono text-xs break-words'>
              Thread #{comment.context.threadId}
              {comment.context.path ? ` · ${comment.context.path}` : ''}
            </p>
          ) : null}
          <p className='text-sm break-words whitespace-pre-wrap'>{comment.body}</p>
        </article>
      ))}
      {query.data.truncated ? (
        <p className='text-muted-foreground text-xs'>Open the Git host for the full discussion.</p>
      ) : null}
    </div>
  )
}
