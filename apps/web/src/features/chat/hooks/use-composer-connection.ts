import type { SessionId } from '@workspace/contracts'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  selectSessionDetailSync,
  useSessionDetailSyncStore,
} from '@/features/chat/state/session-detail-sync-store'
import { composerConnection } from '@/features/chat/utils/composer-connection'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'

export function useComposerConnection(transport: ChatTransport, sessionId: SessionId | null) {
  const unavailable = useUnavailableEnvironment()
  const sync = useSessionDetailSyncStore((state) =>
    selectSessionDetailSync(
      state,
      sessionId ? { environmentId: transport.environmentId, sessionId } : null,
    ),
  )

  return composerConnection({ closed: transport.closed, sync, unavailable })
}
