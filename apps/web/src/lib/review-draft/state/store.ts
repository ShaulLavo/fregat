import { create } from 'zustand'

import { composerAccepts, type ComposerTarget } from '@/lib/composer-attach/utils/target'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

type ReviewDraftStore = {
  readonly comments: readonly ReviewComment[]
  add: (comment: Omit<ReviewComment, 'createdAt' | 'id'>) => ReviewComment
  /** After a send: the comments went out with the message. */
  removeAll: (ids: readonly string[]) => void
}

/**
 * Comments waiting to go out with the next message in their workspace. In memory: a review in
 * progress is the composer's company, and the composer's own draft is the durable part.
 */
export const useReviewDraftStore = create<ReviewDraftStore>((set) => ({
  comments: [],
  add: (input) => {
    const comment: ReviewComment = {
      ...input,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
    }
    set((state) => ({ comments: [...state.comments, comment] }))
    return comment
  },
  removeAll: (ids) =>
    set((state) => ({ comments: state.comments.filter((comment) => !ids.includes(comment.id)) })),
}))

export function addReviewComment(comment: Omit<ReviewComment, 'createdAt' | 'id'>) {
  return useReviewDraftStore.getState().add(comment)
}

export function removeReviewComments(ids: readonly string[]) {
  useReviewDraftStore.getState().removeAll(ids)
}

export function resetReviewDraftStore() {
  useReviewDraftStore.setState({ comments: [] })
}

export function inDestination(comment: ReviewComment, target: ComposerTarget) {
  return composerAccepts(target, comment.destination)
}
