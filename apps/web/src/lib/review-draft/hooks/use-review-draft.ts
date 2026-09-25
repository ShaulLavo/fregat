import { useShallow } from 'zustand/react/shallow'

import type { ComposerDestination } from '@/lib/composer-attach/providers/context'
import { inDestination, useReviewDraftStore } from '@/lib/review-draft/state/store'

/** The review comments waiting for this workspace's next message. */
export function useReviewDraft(destination: ComposerDestination) {
  return useReviewDraftStore(
    useShallow((state) => state.comments.filter((comment) => inDestination(comment, destination))),
  )
}
