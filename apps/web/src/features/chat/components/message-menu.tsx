import type { OrchestrationMessage } from '@workspace/contracts'

import { MenuSurface } from '@/keymap/menus/components/surface'
import type { MenuAnchor } from '@/keymap/menus/utils/virtual-anchor'

import { useMessageMenu } from '../hooks/use-message-menu'
import type { OptimisticChatMessage } from '../state/chat-message-intents'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

/**
 * Mounted by the bubble only while its menu is open, so the timeline action
 * context and the markdown-to-text pass run for the one message being acted
 * on rather than for every row the timeline has virtualised in.
 */
export function MessageMenu({
  anchor,
  checkpointRevertPending,
  message,
  onOpenChange,
  revertTurnCount,
  turnDiffSummary,
}: {
  readonly anchor: MenuAnchor | null
  readonly checkpointRevertPending: boolean
  readonly message: OrchestrationMessage | OptimisticChatMessage
  readonly onOpenChange: (open: boolean) => void
  readonly revertTurnCount: number | null
  readonly turnDiffSummary: ChatTurnDiffSummary | null
}) {
  const menu = useMessageMenu({
    checkpointRevertPending,
    message,
    revertTurnCount,
    turnDiffSummary,
  })

  return (
    <MenuSurface
      anchor={anchor}
      className='w-60'
      menu={menu}
      onOpenChange={onOpenChange}
      open
      surface='chat.message'
    />
  )
}
