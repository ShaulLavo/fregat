import { RobotIcon } from '@phosphor-icons/react'
import type { ScopedSessionRef } from '@workspace/contracts'

import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'

/** Names the agent definition a session runs as; nothing for the default agent. */
export function SessionAgentChip({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const agent = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, sessionRef.environmentId).sessionById[sessionRef.sessionId]
        ?.agent ?? null,
  )
  if (!agent) return null

  return (
    <span
      className='bg-muted text-muted-foreground text-2xs flex max-w-[10rem] shrink-0 items-center gap-1 rounded-md px-1.5 font-mono'
      title={`Runs as the ${agent} agent`}
    >
      <RobotIcon className='size-(--icon-size-sm) shrink-0' />
      <span className='truncate'>{agent}</span>
    </span>
  )
}
