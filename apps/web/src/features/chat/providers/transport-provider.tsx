import { useSyncExternalStore, type ReactNode } from 'react'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { transportFor, subscribeTransports } from '@/features/chat/state/active-transports'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'

export function ChatTransportProvider({ children }: { readonly children: ReactNode }) {
  const environmentId = useEnvironmentId()
  const transport = useSyncExternalStore(subscribeTransports, () => transportFor(environmentId))
  if (!transport)
    return (
      <div className='grid h-full min-h-0 place-content-center'>
        <RingLoader className='size-8' label='Connecting chat' />
      </div>
    )
  return <ChatTransportContext value={transport}>{children}</ChatTransportContext>
}
