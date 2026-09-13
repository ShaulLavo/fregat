import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'
import * as v from 'valibot'

const serverPathsSchema = v.object({
  homePath: v.string(),
  workspaceRoot: v.string(),
  defaultPath: v.string(),
})

type ReadOptions = {
  readonly client: Client
  readonly path: string
  readonly signal: AbortSignal
}

export async function readServerPaths({ client, signal }: Omit<ReadOptions, 'path'>) {
  const { data, error } = await client.health.get({ fetch: { signal } })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return v.parse(serverPathsSchema, data)
}

export async function readDirectory({ client, path, signal }: ReadOptions) {
  const { data, error } = await client.fs.tree.get({
    query: { depth: 1, path },
    fetch: { signal },
  })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return data
}

export async function readFilePreview({
  acceptTextOnly = false,
  client,
  path,
  signal,
}: ReadOptions & { readonly acceptTextOnly?: boolean }) {
  const { data, error } = await client.fs.read.get({
    query: { acceptTextOnly, path },
    fetch: { signal },
  })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return data
}

export async function readEntry({ client, path, signal }: ReadOptions) {
  const { data, error } = await client.fs.stat.get({ query: { path }, fetch: { signal } })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return data
}

export async function readRecentEntries({ client, signal }: Omit<ReadOptions, 'path'>) {
  const { data, error } = await client.fs.recents.get({
    query: { limit: 30, mode: 'folder', showHidden: false },
    fetch: { signal },
  })
  if (error) throw createRpcError(error)
  signal.throwIfAborted()
  return data.entries
}
