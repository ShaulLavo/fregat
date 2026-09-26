import { NotePencilIcon, QuotesIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { use, useState } from 'react'
import type { OrchestrationMessage } from '@workspace/contracts'

import { ReviewCommentInput } from '@/components/review-comment-input'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { markdownQuote, type PlanSelectionLines } from '@/features/chat/utils/plan-comment'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { addReviewComment } from '@/lib/review-draft/state/store'

/** Quote the selected lines of an earlier reply in the next message, with or without a comment. */
export function ReplyQuoteBar({
  message,
  onDone,
  selection,
}: {
  readonly message: Pick<OrchestrationMessage, 'id' | 'sessionId' | 'text'>
  readonly onDone: () => void
  readonly selection: PlanSelectionLines
}) {
  const root = use(ChatWorkspaceRootContext)
  const environmentId = useEnvironmentId()
  const [commenting, setCommenting] = useState(false)
  if (!root) return null

  function quote(body: string) {
    if (!root) return
    addReviewComment({
      anchor: {
        kind: 'message',
        lines: selection,
        messageId: message.id,
        sessionId: message.sessionId,
      },
      author: 'user',
      body: body.trim(),
      destination: { environmentId, rootPath: root.path },
      quote: markdownQuote(message.text, selection, 'your earlier reply'),
    })
    onDone()
  }

  return (
    <div className='mt-2 flex items-center gap-1' data-scroll-anchor-ignore>
      {commenting ? (
        <ReviewCommentInput onCancel={onDone} onSave={quote} />
      ) : (
        <>
          <Button size='sm' type='button' variant='ghost' onClick={() => quote('')}>
            <QuotesIcon data-icon='inline-start' />
            Quote in reply
          </Button>
          <Button size='sm' type='button' variant='ghost' onClick={() => setCommenting(true)}>
            <NotePencilIcon data-icon='inline-start' />
            Comment on the selection
          </Button>
        </>
      )}
    </div>
  )
}
