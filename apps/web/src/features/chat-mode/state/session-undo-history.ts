import { create } from 'zustand'
import type { ProjectId } from '@workspace/contracts'
import {
  createSessionLifecycleHistory,
  type SessionLifecycleUndoEntry,
} from '@workspace/client-core/chat/rail/lifecycle-undo'

export type SessionUndoEntry = SessionLifecycleUndoEntry & {
  readonly reopen: { readonly surface: 'main' | 'sidebar'; readonly projectId: ProjectId } | null
}
export const sessionUndoHistory = createSessionLifecycleHistory<SessionUndoEntry>()
export const useSessionUndoStore = create(() => sessionUndoHistory.getSnapshot())
sessionUndoHistory.subscribe(() => useSessionUndoStore.setState(sessionUndoHistory.getSnapshot()))
