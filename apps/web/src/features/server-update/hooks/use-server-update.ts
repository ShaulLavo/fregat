import type { ServerUpdate } from '@workspace/contracts'

import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

/** The primary server's staged-update state, as its orchestration socket last pushed it. */
export function useServerUpdate(): ServerUpdate | null {
  return useEnvironmentsStore((state) => state.updateByOrigin[primaryServerOrigin()] ?? null)
}
