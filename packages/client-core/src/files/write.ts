import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'
import { createClientError } from '../errors'
import type {
  WorkspaceEditResult,
  WorkspaceEditState,
  WorkspacePersistenceOperation,
} from '@workspace/contracts'

export async function commitWorkspaceEdits({
  client,
  rootPath,
  operations,
  signal,
}: {
  client: Client
  rootPath: string
  operations: readonly WorkspacePersistenceOperation[]
  signal: AbortSignal
}) {
  const operationId = crypto.randomUUID()
  const api = client.fs['workspace-edit']
  let committed = false
  let finalized: WorkspaceEditResult | null = null
  try {
    const prepared = await api.prepare.post(
      {
        category: 'workspace-edit',
        label: 'Workspace edit',
        origin: 'workspace-edit',
        operationId,
        operations,
        workspace: rootPath,
        bodyDigest: await operationsDigest(operations),
      },
      { fetch: { signal } },
    )
    if (prepared.error) throw createRpcError(prepared.error)
    assertState(prepared.data, 'prepared')
    const result = await api.commit.post(transition(prepared.data), { fetch: { signal } })
    if (result.error) throw createRpcError(result.error)
    assertState(result.data, 'committed')
    committed = true
    const cleanupSignal = AbortSignal.timeout(5000)
    finalized = await finalizeEdit(client, result.data, cleanupSignal)
    return await releaseEdit(client, finalized, cleanupSignal)
  } catch (error) {
    const recovered = await recoverEdit(client, operationId, finalized?.generation ?? null).catch(
      (recoveryError: unknown) => {
        throw createClientError({
          code: 'WORKSPACE_EDIT_CLEANUP_FAILED',
          status: 502,
          message: finalized
            ? 'The files were saved, but edit cleanup could not finish.'
            : 'The edit did not finish and transaction cleanup could not be confirmed.',
          why: 'Recovery failed before the server confirmed transaction release.',
          fix: `Reconnect and inspect workspace edit ${operationId} before retrying.`,
          cause: error,
          internal: { operationId, commitAcknowledged: committed, recoveryError },
        })
      },
    )
    if (recovered) return recovered
    throw error
  }
}

function transition(result: WorkspaceEditResult) {
  return {
    operationId: result.operationId,
    expectedGeneration: result.generation,
    transitionId: crypto.randomUUID(),
  }
}

async function finalizeEdit(client: Client, current: WorkspaceEditResult, signal: AbortSignal) {
  const api = client.fs['workspace-edit']
  let result = current
  if (result.state === 'committed') {
    const finalized = await api.finalize.post(transition(result), { fetch: { signal } })
    if (finalized.error) throw createRpcError(finalized.error)
    result = finalized.data
  }
  assertState(result, 'finalized')
  return result
}

async function releaseEdit(client: Client, result: WorkspaceEditResult, signal: AbortSignal) {
  const api = client.fs['workspace-edit']
  const released = await api.release.post(transition(result), { fetch: { signal } })
  if (released.error) throw createRpcError(released.error)
  assertState(released.data, 'released')
  return released.data
}

async function recoverEdit(
  client: Client,
  operationId: string,
  finalizedGeneration: number | null,
) {
  const api = client.fs['workspace-edit']
  const signal = AbortSignal.timeout(5000)
  const status = await api.status.get({ query: { operationId }, fetch: { signal } })
  if (status.error) throw createRpcError(status.error)
  if (!status.data.found) return null
  const result = status.data.result
  // Release erases the prior state; only the next generation after our finalized receipt proves a save.
  if (result.state === 'released')
    return finalizedGeneration !== null && result.generation === finalizedGeneration + 1
      ? result
      : null
  if (result.state === 'committed' || result.state === 'finalized')
    return releaseEdit(client, await finalizeEdit(client, result, signal), signal)
  if (result.state === 'aborted' || result.state === 'rolled-back') {
    await releaseEdit(client, result, signal)
    return null
  }
  if (result.state !== 'prepared' && result.state !== 'preparing') return null
  const aborted = await api.abort.post(transition(result), { fetch: { signal } })
  if (aborted.error) throw createRpcError(aborted.error)
  assertState(aborted.data, 'aborted')
  // Cancelling preparation removes its journal and leaves only an abort receipt.
  if (result.state === 'prepared') await releaseEdit(client, aborted.data, signal)
  return null
}

function assertState(result: WorkspaceEditResult, expected: WorkspaceEditState) {
  if (result.state === expected) return
  throw createClientError({
    code: 'WORKSPACE_EDIT_NOT_SAVED',
    status: 409,
    message: `The file changes were not saved (${result.state}).`,
    why: `Workspace edit ${result.operationId} reached ${result.state} instead of ${expected}.`,
    fix: 'Keep the unsaved changes and inspect the workspace before retrying.',
    internal: {
      operationId: result.operationId,
      expectedState: expected,
      actualState: result.state,
    },
  })
}

async function operationsDigest(operations: readonly WorkspacePersistenceOperation[]) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(operations)),
  )
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
