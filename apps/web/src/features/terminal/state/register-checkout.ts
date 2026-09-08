import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { orchestrationDispatchResultSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { Client } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import {
  createProjectRegistrationCommand,
  projectRegistrationResult,
} from '@workspace/client-core/chat/registration'

export async function registerTerminalCheckout({
  client,
  origin,
  rootPath,
  signal,
}: {
  client: Client
  origin: string
  rootPath: string
  signal: AbortSignal
}) {
  signal.throwIfAborted()
  confirmedEnvironmentId(origin)
  const title = rootPath.split('/').filter(Boolean).at(-1) ?? 'Workspace'
  const response = await client.orchestration.commands.post(
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
