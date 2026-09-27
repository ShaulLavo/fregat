import { useState } from 'react'
import {
  sessionLifecycleVerb,
  type SessionLifecycleUndoKind,
} from '@workspace/client-core/chat/rail/lifecycle-undo'
import { useSessionUndoStore } from '@/features/chat-mode/state/session-undo-history'

/** A session Undo or Redo notice's title; its count follows the batch as rows are forgotten. */
export function SessionUndoNoticeTitle({
  batchId,
  kind,
  detail,
  count,
  undone,
}: {
  readonly batchId: number
  readonly kind: SessionLifecycleUndoKind
  readonly detail: string
  readonly count: number
  readonly undone: boolean
}) {
  // A closing notice outlives its batch; it keeps the last count it showed.
  const live = useSessionUndoStore(
    (state) =>
      (
        state.undo.find((batch) => batch.id === batchId) ??
        state.redo.find((batch) => batch.id === batchId)
      )?.entries.length,
  )
  const [shown, setShown] = useState(count)
  if (live !== undefined && live !== shown) setShown(live)
  const summary = `${shown} ${sessionLifecycleVerb(kind)}${detail}`
  return undone ? `Undid ${summary}` : summary
}
