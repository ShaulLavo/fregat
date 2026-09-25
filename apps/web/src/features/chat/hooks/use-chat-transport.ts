import { use } from 'react'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { requireContext } from '@/lib/require-context'

export function useChatTransport() {
  const transport = use(ChatTransportContext)
  requireContext(transport, 'Chat transport requires ChatTransportProvider.')
  return transport
}
