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

const workspaceAddressLookupSchema = v.object({
  entries: v.array(v.object({ path: v.string(), address: v.nullable(workspaceAddressSchema) })),
})

/** One request for many candidate roots; a path that cannot be a root answers `address: null`. */
export async function lookupWorkspaceAddresses({
  client,
  paths,
  signal,
}: RequestOptions & { readonly paths: readonly string[] }) {
  const { data, error } = await client.fs['workspace-addresses'].post(
    { paths },
    { fetch: { signal } },
  )
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return v.parse(workspaceAddressLookupSchema, data).entries
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
