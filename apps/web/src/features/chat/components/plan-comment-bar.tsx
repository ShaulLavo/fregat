import { NotePencilIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { use, useState } from 'react'

import { ReviewCommentInput } from '@/components/review-comment-input'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { planCommentQuote, type PlanSelectionLines } from '@/features/chat/utils/plan-comment'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { addReviewComment } from '@/lib/review-draft/state/store'

/** Comment on the part of a plan the reader selected; it joins the review for the next message. */
export function PlanCommentBar({
  planId,
  planMarkdown,
  selection,
  onDone,
}: {
  readonly planId: string
  readonly planMarkdown: string
  readonly selection: PlanSelectionLines
  readonly onDone: () => void
}) {
  const root = use(ChatWorkspaceRootContext)
  const environmentId = useEnvironmentId()
  const [commenting, setCommenting] = useState(false)
  const lines = selection
  if (!lines || !root) return null

  function save(body: string) {
    if (!lines || !root || !body.trim()) return
    addReviewComment({
      anchor: { kind: 'plan', lines, planId },
      author: 'user',
      body,
      destination: { environmentId, rootPath: root.path },
      quote: planCommentQuote(planMarkdown, lines),
    })
    onDone()
  }

  return (
    <div className='mt-2 flex items-center gap-1'>
      {commenting ? (
        <ReviewCommentInput onCancel={onDone} onSave={save} />
      ) : (
        <Button size='sm' type='button' variant='ghost' onClick={() => setCommenting(true)}>
          <NotePencilIcon data-icon='inline-start' />
          Comment on the selection
        </Button>
      )}
    </div>
  )
}
