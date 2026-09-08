import * as v from 'valibot'
import { commandIdSchema, worktreeIdSchema } from '@workspace/contracts'
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
  const result = await rpc.dispatchCommand({
    type: 'project.create',
    commandId: v.parse(commandIdSchema, crypto.randomUUID()),
    workspaceRoot,
    title: workspaceRoot.split('/').filter(Boolean).at(-1) ?? 'Root',
    defaultModelSelection: null,
  })
  signal.throwIfAborted()
  return v.parse(v.object({ worktreeId: worktreeIdSchema }), result.result).worktreeId
}
