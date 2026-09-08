import * as v from 'valibot'
import { workspaceAddressSchema, type WorkspaceAddressId } from '@workspace/contracts'
import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'

type RequestOptions = {
  readonly client: Client
  readonly signal: AbortSignal
}

export async function registerWorkspaceAddress({
  client,
  path,
  signal,
}: RequestOptions & { readonly path: string }) {
  const { data, error } = await client.fs['workspace-address'].post({ path }, { fetch: { signal } })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return v.parse(workspaceAddressSchema, data)
}

export async function readWorkspaceAddress({
  client,
  id,
  signal,
}: RequestOptions & { readonly id: WorkspaceAddressId }) {
  const { data, error } = await client.fs['workspace-address']({ id }).get({ fetch: { signal } })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return v.parse(workspaceAddressSchema, data)
}
