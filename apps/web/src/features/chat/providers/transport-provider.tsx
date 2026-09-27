import type { ReactNode } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { useActiveTransport } from '@/features/chat/hooks/use-active-transport'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'

export function ChatTransportProvider({ children }: { readonly children: ReactNode }) {
  const environmentId = useEnvironmentId()
  const transport = useActiveTransport(environmentId)
  if (!transport)
    return (
      <div className='grid h-full min-h-0 place-content-center'>
        <Spinner size='lg' label='Connecting chat' />
      </div>
    )
  return <ChatTransportContext value={transport}>{children}</ChatTransportContext>
}
