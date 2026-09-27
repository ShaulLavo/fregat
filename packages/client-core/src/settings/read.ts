import { settingsSnapshotSchema, type SettingsSnapshot } from '@workspace/contracts'
import * as v from 'valibot'
import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'
import { settingsSnapshotUnreadableError } from './structured-errors'

export async function readSettings({
  client,
  signal,
}: {
  readonly client: Client
  readonly signal?: AbortSignal
}): Promise<SettingsSnapshot> {
  const { data, error } = await client.settings.get({ fetch: { signal } })
  if (error) throw createRpcError(error)
  signal?.throwIfAborted()
  const parsed = v.safeParse(settingsSnapshotSchema, data)
  if (!parsed.success) throw settingsSnapshotUnreadableError(parsed.issues)
  return parsed.output
}
