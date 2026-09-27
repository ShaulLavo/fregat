import {
  settingsMutationResultSchema,
  settingsRawWriteResultSchema,
  errorNumberField,
  errorStringField,
  type SettingsMutationRequest,
  type SettingsRawWriteRequest,
} from '@workspace/contracts'
import * as v from 'valibot'

import type { Client } from '../transport/client'
import { normalizeEdenDates } from '../transport/normalize-dates'
import { isConnectivityError } from '../transport/connectivity-error'
import { settingsInvariantError } from './structured-errors'
import { createRpcError } from '../transport/rpc-error'

export async function writeSettings({
  client,
  request,
  signal,
}: {
  readonly client: Client
  readonly request: SettingsMutationRequest
  readonly signal?: AbortSignal
}) {
  const { data, error } = await client.settings.write.post(request, { fetch: { signal } })
  if (error) throw createRpcError(error)
  return v.parse(settingsMutationResultSchema, data)
}

export async function writeSettingsText({
  client,
  request,
  signal,
}: {
  readonly client: Client
  readonly request: SettingsRawWriteRequest
  readonly signal?: AbortSignal
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      signal?.throwIfAborted()
      return await postSettingsText(client, request, signal)
    } catch (error) {
      if (!retryRawTransport(error) || attempt === 2) throw error
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100 * 2 ** attempt))
    }
  }
  throw settingsInvariantError('Raw settings retry ended without a result')
}

async function postSettingsText(
  client: Client,
  request: SettingsRawWriteRequest,
  signal?: AbortSignal,
) {
  const { data, error } = await client.settings.raw.post(request, { fetch: { signal } })
  if (error) throw createRpcError(error)
  return v.parse(settingsRawWriteResultSchema, data)
}

function retryRawTransport(error: unknown) {
  if (errorStringField(error, 'code') === 'settings.RAW_REVISION_STALE') return false
  if (isConnectivityError(error)) return true
  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  return status !== undefined && status >= 500
}

export async function* parseSettingsStream(
  stream: unknown,
): AsyncGenerator<{ readonly event: string; readonly data: unknown }> {
  if (!stream || typeof stream !== 'object' || !(Symbol.asyncIterator in stream)) {
    throw settingsInvariantError('The settings event stream is missing')
  }
  if (typeof stream[Symbol.asyncIterator] !== 'function') {
    throw settingsInvariantError('The settings event stream cannot be read')
  }
  for await (const event of stream as AsyncIterable<unknown>) {
    if (!event || typeof event !== 'object' || !('data' in event)) continue
    yield {
      event: 'event' in event && typeof event.event === 'string' ? event.event : 'message',
      data: normalizeEdenDates(event.data),
    }
  }
}
