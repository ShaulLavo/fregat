import { resolve } from 'node:path'

const lanes = new Map<string, Promise<void>>()
export async function withAttachmentLane<T>(
  directory: string,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${resolve(directory)}:${id}`
  const previous = lanes.get(key) ?? Promise.resolve()
  const pending = previous.then(operation, operation)
  const settled = pending.then(
    () => undefined,
    () => undefined,
  )
  lanes.set(key, settled)
  try {
    return await pending
  } finally {
    if (lanes.get(key) === settled) lanes.delete(key)
  }
}

export function withAttachmentLanes<T>(
  directory: string,
  ids: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const sorted = [...new Set(ids)].sort()
  function acquire(index: number): Promise<T> {
    if (index === sorted.length) return operation()
    return withAttachmentLane(directory, sorted[index]!, () => acquire(index + 1))
  }
  return acquire(0)
}
