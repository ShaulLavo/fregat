import { useQuery } from '@tanstack/react-query'
import { hasMermaidFence } from '@/features/chat/utils/markdown-fence'
import { mermaidQueryOptions, type MermaidRenderer } from '@/features/chat/state/mermaid'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function useMermaid(text: string, streaming: boolean): MermaidRenderer | null {
  const wanted = !streaming && hasMermaidFence(text)
  const query = useQuery(
    {
      ...mermaidQueryOptions,
      // A streaming/settled toggle must also preserve the failed import for this session.
      enabled: (resource) => wanted && resource.state.status !== 'error',
    },
    resourceQueryClient,
  )
  return wanted ? (query.data ?? null) : null
}
