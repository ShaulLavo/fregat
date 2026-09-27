import { useQuery } from '@tanstack/react-query'

import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { useShellStore } from '@/lib/shell/state/store'
import { shellQueryOptions } from '@/features/workspace/utils/shell-query'

/** The shell on screen: the viewport's choice once its chunk has loaded, the previous one until then. */
export function useDisplayedShell() {
  const wanted = useShellStore((state) => state.kind)
  const wantedQuery = useQuery(shellQueryOptions(wanted), resourceQueryClient)
  const kind = useHeldUntilReady(wanted, wantedQuery.isSuccess)
  const query = useQuery(shellQueryOptions(kind), resourceQueryClient)
  return { kind, query }
}
