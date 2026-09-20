import { isObject } from '@workspace/utils/objects'
export type ClientErrorMetadata = {
  readonly context: Readonly<Record<string, unknown>>
  readonly operation: string
}

const metadataByError = new WeakMap<object, ClientErrorMetadata>()

export function annotateClientError(error: unknown, metadata: ClientErrorMetadata): void {
  if (!isObject(error)) return

  const existing = metadataByError.get(error)
  if (!existing) {
    metadataByError.set(error, metadata)
    return
  }

  metadataByError.set(error, {
    context: { ...metadata.context, ...existing.context },
    operation: existing.operation,
  })
}

export function clientErrorMetadata(error: unknown): ClientErrorMetadata | undefined {
  if (!isObject(error)) return undefined

  return metadataByError.get(error)
}
