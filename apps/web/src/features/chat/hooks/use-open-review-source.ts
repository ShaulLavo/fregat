import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionId } from '@workspace/contracts'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { toast } from 'sonner'

import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { fileReferenceDefinitionTarget } from '@/features/chat/hooks/use-open-file-reference'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useTimelineRevealStore } from '@/features/chat/state/timeline-reveal-store'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { blockQuoteLines, diffQuoteNewLines, linesMatch } from '@/features/chat/utils/review-source'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import type { SentReviewComment } from '@/lib/review-draft/utils/types'

/** How far back a cited reply is looked for before it counts as gone. */
const MAX_EARLIER_PAGES = 50

type Outcome = 'opened' | 'changed' | 'missing'

/**
 * Takes the reader to what a sent review comment quoted: the file lines, the plan lines, or the
 * earlier reply. A source that no longer reads as quoted is reported, never swapped for other lines.
 */
export function useOpenReviewSource() {
  const transport = useChatTransport()
  const client = clientForQueryClient(useQueryClient())
  const { openDefinition } = useEditorCommands()

  const session = (sessionId: SessionId) =>
    selectChatSessionById(
      selectChatProjectionSlice(useChatProjectionStore.getState(), transport.environmentId),
      sessionId,
    )

  async function openDiff(comment: SentReviewComment & { anchor: { kind: 'diff' } }) {
    const range = comment.anchor.newRange
    const expected = diffQuoteNewLines(comment.quote)
    // A diff names its file by server path, the same one the diff was read from.
    const path = comment.anchor.path
    if (!range || !expected) return 'missing'
    const file = await fetchFile(filesystemPath(path), new AbortController().signal, client).catch(
      () => null,
    )
    if (!file) return 'missing'
    if (!linesMatch(file.content, range, expected)) return 'changed'
    openDefinition(
      fileReferenceDefinitionTarget({ column: 1, label: path, line: range.start, path }),
    )
    return 'opened'
  }

  async function openReply(
    comment: SentReviewComment & { anchor: { kind: 'message' } },
  ): Promise<Outcome> {
    const sessionId = comment.anchor.sessionId as SessionId
    for (let page = 0; page <= MAX_EARLIER_PAGES; page++) {
      const message = session(sessionId)?.messages.find(
        (entry) => entry.id === comment.anchor.messageId,
      )
      if (message) {
        if (!linesMatch(message.text, comment.anchor.lines, blockQuoteLines(comment.quote)))
          return 'changed'
        useTimelineRevealStore.getState().reveal({ rowId: `message:${message.id}`, sessionId })
        return 'opened'
      }
      // Older history loads a page at a time until the reply is found or there is none left.
      if (!(await transport.loadEarlierPage(sessionId))) return 'missing'
    }
    return 'missing'
  }

  function openPlan(comment: SentReviewComment & { anchor: { kind: 'plan' } }): Outcome {
    const slice = selectChatProjectionSlice(
      useChatProjectionStore.getState(),
      transport.environmentId,
    )
    const planId = comment.anchor.planId
    const owner = slice.sessionIds.find((id) =>
      Object.hasOwn(slice.proposedPlanBySessionId[id] ?? {}, planId),
    )
    const plan = owner
      ? Object.values(slice.proposedPlanBySessionId[owner] ?? {}).find(
          (entry) => entry.id === planId,
        )
      : undefined
    if (!owner || !plan) return 'missing'
    if (!linesMatch(plan.planMarkdown, comment.anchor.lines, blockQuoteLines(comment.quote)))
      return 'changed'
    useTimelineRevealStore
      .getState()
      .reveal({ rowId: `proposed-plan:${plan.id}`, sessionId: owner })
    return 'opened'
  }

  return useMutation({
    mutationKey: chatMutationKeys.openReviewSource(transport.environmentId),
    mutationFn: async (comment: SentReviewComment): Promise<Outcome> => {
      const { anchor } = comment
      if (anchor.kind === 'diff') return openDiff({ ...comment, anchor })
      if (anchor.kind === 'message') return openReply({ ...comment, anchor })
      return openPlan({ ...comment, anchor })
    },
    onSuccess: (outcome) => {
      if (outcome === 'changed')
        toast.warning('Those lines have changed since this comment was sent')
      if (outcome === 'missing') toast.warning('The commented source is no longer available')
    },
  })
}
