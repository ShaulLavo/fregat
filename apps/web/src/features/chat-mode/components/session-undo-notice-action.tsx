import { Button } from '@workspace/ui/components/button'
import { canStepSessionLifecycleBatch } from '@workspace/client-core/chat/rail/lifecycle-undo'
import type { HistoryDirection } from '@workspace/client-core/history/undo-stack'
import { useSessionUndoStore } from '@/features/chat-mode/state/session-undo-history'

export function SessionUndoNoticeAction({
  batchId,
  direction,
  onClick,
}: {
  readonly batchId: number
  readonly direction: HistoryDirection
  readonly onClick: () => void
}) {
  const available = useSessionUndoStore((state) =>
    canStepSessionLifecycleBatch(state[direction], batchId),
  )
  return (
    <Button size='sm' variant='secondary' disabled={!available} onClick={onClick}>
      {direction === 'undo' ? 'Undo' : 'Redo'}
    </Button>
  )
}
