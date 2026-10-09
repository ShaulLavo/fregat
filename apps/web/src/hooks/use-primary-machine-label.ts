import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

/** The name the primary server reports for its machine, once its descriptor has arrived. */
export function usePrimaryMachineLabel() {
  return useEnvironmentsStore((state) => state.entries[primaryServerOrigin()]?.label ?? null)
}
