import * as v from 'valibot'
import type { Client } from '../transport/client'
import { createRpcError } from '../transport/rpc-error'
import { createClientError } from '../errors'

const descriptorSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  revision: v.pipe(v.string(), v.nonEmpty()),
  maxRangeBytes: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  byteLength: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
})

export async function openFileReadSession({
  client,
  path,
  signal,
}: {
  client: Client
  path: string
  signal: AbortSignal
}) {
  const opened = await client.fs['read-session'].post(undefined, {
    query: { path },
    fetch: { signal },
  })
  if (opened.error) throw createRpcError(opened.error)
  const descriptor = v.parse(descriptorSchema, opened.data)
  const api = client.fs['read-session']({ id: descriptor.id })
  if (signal.aborted) {
    await api.delete()
    signal.throwIfAborted()
  }
  return {
    ...descriptor,
    async readBytes(start: number, end: number, signal: AbortSignal) {
      const result = await api.get({ query: { start, end }, fetch: { signal } })
      if (result.error) throw createRpcError(result.error)
      signal.throwIfAborted()
      const revision = new Headers(result.headers).get('x-fs-revision')
      if (
        !(result.data instanceof ArrayBuffer) ||
        result.data.byteLength !== end - start ||
        revision !== descriptor.revision
      ) {
        throw createClientError({
          code: 'FILE_RANGE_INCOMPLETE',
          status: 502,
          message: 'The file page could not be read completely.',
          why: 'The returned bytes or revision differ from the requested file page.',
          fix: 'Reopen the file to start a new read session.',
          internal: {
            start,
            end,
            expectedRevision: descriptor.revision,
            receivedRevision: revision,
            receivedBytes: result.data instanceof ArrayBuffer ? result.data.byteLength : null,
          },
        })
      }
      return { revision, bytes: new Uint8Array(result.data) }
    },
    async dispose() {
      const result = await api.delete()
      if (result.error) throw createRpcError(result.error)
    },
  }
}
