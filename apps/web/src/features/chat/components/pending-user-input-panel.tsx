import { PendingUserInputCard } from '@/features/chat/components/pending-user-input-card'
import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'

export function PendingUserInputPanel() {
  const { pendingUserInputs } = usePendingRequests()
  const pending = pendingUserInputs[0]
  if (!pending) return null

  return <PendingUserInputCard key={pending.requestId} pending={pending} />
}
