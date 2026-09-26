import {
  createProjectRegistrationCommand,
  projectRegistrationResult,
} from '@workspace/client-core/chat/registration'
import { readServerPaths } from '@workspace/client-core/files/read'
import { absolutePickerPath } from '@workspace/client-core/files/path-input'
import type { Client } from '@workspace/client-core/transport/client'
import type { OrchestrationRpcClient } from '@workspace/client-core/transport/orchestration-rpc-client'

export async function ensureWorktree({
  client,
  rpc,
  rootPath,
  signal,
}: {
  readonly client: Client
  readonly rpc: OrchestrationRpcClient
  readonly rootPath: string
  readonly signal: AbortSignal
}) {
  const paths = await readServerPaths({ client, signal })
  const workspaceRoot = absolutePickerPath(rootPath, paths.workspaceRoot)
  const result = await rpc.dispatchCommand(
    createProjectRegistrationCommand({
      workspaceRoot,
      title: workspaceRoot.split('/').filter(Boolean).at(-1) ?? 'Root',
    }),
  )
  signal.throwIfAborted()
  return projectRegistrationResult(result).worktreeId
}
