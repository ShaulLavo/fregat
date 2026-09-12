import { useState, type ComponentProps, type ReactNode } from 'react'
import type { SessionId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { ChatDraftView } from '@/features/chat/components/chat-draft-view'
import { ChatView } from '@/features/chat/components/chat-view'
import { ComposerActivityStatus } from '@/features/chat/components/composer-activity-status'
import { ChatPendingRequestsProvider } from '@/features/chat/providers/pending-requests-provider'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { ChatProviderSignInProvider } from '@/features/chat/providers/provider-sign-in-provider'
import { ChatTransportProvider } from '@/features/chat/providers/transport-provider'
import { TestEditorStateProvider } from './editor-state-provider'
import { renderWithProviders } from '../render'
import { unsupportedChatTransport } from './chat-transport'

export function renderCachedChatSelection(sessionId: SessionId) {
  return renderChatSurface(
    <ChatTransportProvider>
      <SessionSelection sessionId={sessionId} />
    </ChatTransportProvider>,
  )
}

export function renderChatDraft(props: ComponentProps<typeof ChatDraftView>) {
  return renderChatSurface(<ChatDraftView {...props} />)
}

export function renderComposerActivity(props: ComponentProps<typeof ComposerActivityStatus>) {
  return renderWithProviders(
    <ChatPendingRequestsProvider
      transport={unsupportedChatTransport()}
      sessionId={props.session.id}
    >
      <ComposerActivityStatus {...props} />
    </ChatPendingRequestsProvider>,
  )
}

function renderChatSurface(children: ReactNode) {
  return renderWithProviders(
    <TestEditorStateProvider>
      <ChatProviderSignInProvider>{children}</ChatProviderSignInProvider>
    </TestEditorStateProvider>,
  )
}

function SessionSelection({ sessionId }: { readonly sessionId: SessionId }) {
  const [selected, setSelected] = useState<SessionId | null>(null)
  const transport = useChatTransport()
  return (
    <>
      <Button onClick={() => setSelected(sessionId)}>Open cached session</Button>
      <ChatView
        activeSessionId={selected}
        transport={transport}
        onSessionCreated={setSelected}
        rootPath='/repo/platform'
      />
    </>
  )
}
