import { useShallow } from 'zustand/react/shallow'

import type { ComposerTarget } from '@/lib/composer-attach/utils/target'
import { inDestination, useReviewDraftStore } from '@/lib/review-draft/state/store'

/** The review comments waiting for this workspace's next message. */
export function useReviewDraft(target: ComposerTarget) {
  return useReviewDraftStore(
    useShallow((state) => state.comments.filter((comment) => inDestination(comment, target))),
  )
}
