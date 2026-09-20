import { useShallow } from 'zustand/react/shallow'
import type { ScopedSessionRef } from '@workspace/contracts'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'

export function SessionTitleStatus({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const status = useChatProjectionStore(
    useShallow((state) => {
      const session = selectChatProjectionSlice(state, sessionRef.environmentId).sessionById[
        sessionRef.sessionId
      ]
      return {
        pending: Boolean(session?.titleRegeneration),
        error: session?.titleGenerationError ?? null,
      }
    }),
  )
  if (status.pending)
    return (
      <span className='text-muted-foreground text-2xs inline-flex shrink-0 items-center gap-(--density-gap-tight)'>
        <OrbitLoader className='size-(--icon-size-sm)' label='Generating title' />
        Generating title
      </span>
    )
  if (!status.error) return null
  return (
    <span className='text-destructive text-2xs' role='status' title={status.error}>
      Title generation failed
    </span>
  )
}
