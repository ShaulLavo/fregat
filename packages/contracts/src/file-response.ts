import * as v from 'valibot'
import { createStructuredError } from '@workspace/observability/errors'
import { decodeText } from './text-encoding'

const metadataSchema = v.object({
  path: v.string(),
  size: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  mtimeMs: v.pipe(v.number(), v.finite()),
  version: v.pipe(v.string(), v.regex(/^sha256:[a-f0-9]{64}$/u)),
})

export function decodeFileResponse(data: unknown, headers: Headers) {
  const metadata = v.parse(metadataSchema, {
    path: decodeURIComponent(headers.get('x-fs-path') ?? ''),
    size: Number(headers.get('x-fs-size') ?? NaN),
    mtimeMs: Number(headers.get('x-fs-mtime-ms') ?? NaN),
    version: headers.get('x-fs-version'),
  })
  if (!(data instanceof ArrayBuffer) || data.byteLength !== metadata.size) {
    throw createStructuredError({
      code: 'FILE_READ_INCOMPLETE',
      status: 502,
      message: 'The file download was incomplete.',
      why: 'The received bytes do not match the file metadata.',
      fix: 'Retry opening the file.',
      internal: {
        expectedBytes: metadata.size,
        receivedBytes: data instanceof ArrayBuffer ? data.byteLength : null,
      },
    })
  }
  return { ...metadata, ...decodeText(new Uint8Array(data)) }
}

export function createFileResponse(
  bytes: Uint8Array<ArrayBuffer>,
  metadata: v.InferOutput<typeof metadataSchema>,
) {
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'x-content-type-options': 'nosniff',
      'x-fs-path': encodeURIComponent(metadata.path),
      'x-fs-size': String(bytes.byteLength),
      'x-fs-mtime-ms': String(metadata.mtimeMs),
      'x-fs-version': metadata.version,
    },
  })
}
