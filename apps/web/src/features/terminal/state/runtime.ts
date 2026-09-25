import { GhosttyRuntime } from 'ghostty-webgpu'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'

export function initializeGhostty() {
  return resourceQueryClient.query({
    queryKey: terminalQueryKeys.runtime,
    queryFn: () => GhosttyRuntime.create(),
    staleTime: 'static',
    gcTime: Infinity,
    networkMode: 'always',
    structuralSharing: false,
    retry: false,
  })
}
