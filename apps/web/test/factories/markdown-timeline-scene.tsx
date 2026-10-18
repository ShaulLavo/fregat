import type { ChatSession } from '@workspace/client-core/chat/types'
import { useEffect, useLayoutEffect, useState } from 'react'

import { ChatInput } from '@/features/chat/components/chat-input'
import { MessagesTimeline } from '@/features/chat/components/messages-timeline'
import { ChatTimelineActionsProvider } from '@/features/chat/providers/timeline-actions-provider'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { activeServerOrigin } from '@/lib/client'
import { createClientInvariantError } from '@/lib/structured-errors'

export function ProductionMarkdownTimeline({
  session,
  revision,
  onCommitted,
}: {
  readonly session: ChatSession
  readonly revision: number
  readonly onCommitted: (timestamp: number) => void
}) {
  const [transport] = useState(() => createChatTransport(activeServerOrigin()))
  useEffect(() => () => transport.close(), [transport])
  useLayoutEffect(() => onCommitted(performance.now()), [onCommitted, revision])
  const busy = session.messages.at(-1)?.streaming ?? false
  return (
    <ChatTransportContext value={transport}>
      <ChatTimelineActionsProvider
        retry={{ blocked: true, carryOn: rejectAction, tryAgain: null }}
        revertToCheckpoint={rejectAction}
      >
        <section className='flex h-dvh min-h-0 flex-col' data-markdown-production-timeline='true'>
          <div className='min-h-0 flex-1'>
            <MessagesTimeline optimisticMessages={[]} session={session} />
          </div>
          <ChatInput
            busy={busy}
            disabled={false}
            draftKey='markdown-production'
            error={null}
            interactionMode='default'
            modelSelection={null}
            onPersistModelSelection={rejectAction}
            onStop={rejectAction}
            onSubmit={rejectAction}
            rootPath='repo'
            runtimeMode='full-access'
          />
        </section>
      </ChatTimelineActionsProvider>
    </ChatTransportContext>
  )
}

function rejectAction(): never {
  throw createClientInvariantError('A production timeline command was invoked')
}
