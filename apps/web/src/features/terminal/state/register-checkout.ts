import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { orchestrationDispatchResultSchema } from '@workspace/contracts'
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import * as v from 'valibot'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'
import {
  createProjectRegistrationCommand,
  projectRegistrationResult,
} from '@workspace/client-core/chat/registration'

export function terminalCheckoutQueryOptions(rootPath: string) {
  return queryOptions({
    queryFn: ({ client, signal }) => registerTerminalCheckout(rootPath, client, signal),
    queryKey: terminalQueryKeys.checkout(rootPath),
    staleTime: Infinity,
  })
}

export function fetchTerminalCheckout(queryClient: QueryClient, rootPath: string) {
  return queryClient.fetchQuery(terminalCheckoutQueryOptions(rootPath))
}

async function registerTerminalCheckout(
  rootPath: string,
  queryClient: QueryClient,
  signal: AbortSignal,
) {
  const origin = originForQueryClient(queryClient)
  confirmedEnvironmentId(origin)
  const title = rootPath.split('/').filter(Boolean).at(-1) ?? 'Workspace'
  const response = await clientForQueryClient(queryClient).orchestration.commands.post(
    createProjectRegistrationCommand({ workspaceRoot: rootPath, title }),
    { fetch: { signal } },
  )
  signal.throwIfAborted()
  confirmedEnvironmentId(origin)
  return projectRegistrationResult(
    v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(response, {
        requireData: true,
        emptyMessage: 'Project registration returned no checkout identity.',
        normalizeDates: true,
      }),
    ),
  ).worktreeId
}
