import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EnvironmentId, SessionId } from '@workspace/contracts'
import type {
  ReviewCommentAnchor,
  SentReviewComment,
} from '@workspace/client-core/chat/review-comments'
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
import { blockQuoteLines, diffQuoteLines, linesMatch } from '@/features/chat/utils/review-source'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { getNavigation } from '@/state/navigation-binding'

/** How far back a cited reply is looked for before it counts as gone. */
const MAX_EARLIER_PAGES = 50
/** How long an opened session may take to load before its cited row counts as gone. */
const SESSION_LOAD_MS = 15_000

/** `left`: the reader navigated elsewhere before the source opened, so nothing is reported. */
type Outcome = 'opened' | 'changed' | 'missing' | 'left'
type Anchored<K extends ReviewCommentAnchor['kind']> = SentReviewComment & {
  anchor: Extract<ReviewCommentAnchor, { kind: K }>
}

/**
 * Takes the reader to what a sent review comment quoted: the file lines, the deleted lines in
 * their diff, the plan lines, or the earlier reply. A reply or plan in another session opens that
 * session first. A source that no longer reads as quoted is reported, never swapped for others.
 */
export function useOpenReviewSource(hostSessionId: SessionId) {
  const transport = useChatTransport()
  const queryClient = useQueryClient()
  const { openDefinition, openTabContent } = useEditorCommands()
  const environmentId = transport.environmentId

  async function openDiff(comment: Anchored<'diff'>): Promise<Outcome> {
    const { anchor } = comment
    if (anchor.newRange) return openFileLines(comment, anchor.newRange)
    if (anchor.oldRange) return openDeletedLines(comment, anchor.oldRange)
    return 'missing'
  }

  /** New-side lines are checked against the file as it reads now, then opened there. */
  async function openFileLines(comment: Anchored<'diff'>, range: LineRange): Promise<Outcome> {
    const expected = diffQuoteLines(comment.quote, 'new')
    const path = comment.anchor.path
    if (!expected) return 'missing'
    const file = await queryClient
      .query({ ...fileSnapshotQueryOptions(filesystemPath(path)), staleTime: 0 })
      .catch(() => null)
    if (!file) return 'missing'
    if (!linesMatch(materializeFileSnapshotText(file), range, expected)) return 'changed'
    openDefinition(
      fileReferenceDefinitionTarget({ column: 1, label: path, line: range.start, path }),
    )
    return 'opened'
  }

  /** Deleted lines live only in the version they were deleted from: its diff is opened. */
  async function openDeletedLines(comment: Anchored<'diff'>, range: LineRange): Promise<Outcome> {
    const { anchor } = comment
    const expected = diffQuoteLines(comment.quote, 'old')
    if (!expected || !anchor.oldObjectId) return 'missing'
    const diffs = await queryClient
      .query(
        blobDiffQueryOptions({
          newObjectId: anchor.newObjectId,
          oldObjectId: anchor.oldObjectId,
          path: anchor.path,
        }),
      )
      .catch(() => null)
    const diff = diffs?.find((entry) => entry.oldText !== undefined)
    const document = diff ? snapshotDocument(diff) : null
    if (!diff?.oldText || !document) return 'missing'
    if (!linesMatch(diff.oldText, range, expected)) return 'changed'
    openTabContent(documentTab(document))
    return 'opened'
  }

  async function openReply(comment: Anchored<'message'>): Promise<Outcome> {
    const sessionId = comment.anchor.sessionId as SessionId
    const shown = await showSession(sessionId)
    if (shown !== 'opened') return shown
    for (let page = 0; page <= MAX_EARLIER_PAGES; page++) {
      const message = session(environmentId, sessionId)?.messages.find(
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

  async function openPlan(comment: Anchored<'plan'>): Promise<Outcome> {
    const sessionId = comment.anchor.sessionId as SessionId
    const shown = await showSession(sessionId)
    if (shown !== 'opened') return shown
    const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
    const plan = Object.values(slice.proposedPlanBySessionId[sessionId] ?? {}).find(
      (entry) => entry.id === comment.anchor.planId,
    )
    if (!plan) return 'missing'
    if (!linesMatch(plan.planMarkdown, comment.anchor.lines, blockQuoteLines(comment.quote)))
      return 'changed'
    useTimelineRevealStore.getState().reveal({ rowId: `proposed-plan:${plan.id}`, sessionId })
    return 'opened'
  }

  /** The session that owns a cited row, opened and loaded when the chip sits in another one. */
  async function showSession(sessionId: SessionId): Promise<Outcome> {
    if (sessionId === hostSessionId) return 'opened'
    if (!session(environmentId, sessionId)) return 'missing'
    const navigation = await getNavigation().openChat({ environmentId, sessionId, surface: 'main' })
    if (navigation.status === 'superseded') return 'left'
    if (navigation.status !== 'applied') return 'missing'
    return (await sessionDetailLoaded(environmentId, sessionId)) ? 'opened' : 'missing'
  }

  return useMutation({
    mutationKey: chatMutationKeys.openReviewSource(environmentId),
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

type LineRange = { readonly start: number; readonly end: number }

function session(environmentId: EnvironmentId, sessionId: SessionId) {
  return selectChatSessionById(
    selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId),
    sessionId,
  )
}

/** Resolves once the session's detail is in the projection, or false when it never arrives. */
function sessionDetailLoaded(environmentId: EnvironmentId, sessionId: SessionId) {
  const loaded = () =>
    selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
      .sessionDetailSequenceById[sessionId] !== undefined
  if (loaded()) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, SESSION_LOAD_MS)
    const unsubscribe = useChatProjectionStore.subscribe(() => {
      if (!loaded()) return
      clearTimeout(timer)
      unsubscribe()
      resolve(true)
    })
  })
}
