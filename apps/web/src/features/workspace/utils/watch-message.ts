import type { WatchServerMessage } from '@workspace/contracts'

type FilesystemEvent = Extract<
  WatchServerMessage,
  { type: 'created' | 'changed' | 'deleted' | 'renamed' }
>

export function watchServerMessage(data: unknown): WatchServerMessage | null {
  if (!data || typeof data !== 'object') return null
  if (!('type' in data) || typeof data.type !== 'string') return null
  if (data.type === 'ready' && hasString(data, 'root')) {
    return data as WatchServerMessage
  }
  if (data.type === 'error' && hasString(data, 'code') && hasString(data, 'message')) {
    return data as WatchServerMessage
  }
  if (isBasicFilesystemMessage(data)) return data
  if (data.type === 'renamed' && hasString(data, 'path') && hasString(data, 'oldPath')) {
    return data as WatchServerMessage
  }

  return null
}

function isBasicFilesystemMessage(
  data: object,
): data is Extract<FilesystemEvent, { type: 'created' | 'changed' | 'deleted' }> {
  if (!('type' in data) || !('path' in data)) return false
  if (typeof data.path !== 'string') return false

  return data.type === 'created' || data.type === 'changed' || data.type === 'deleted'
}

function hasString<T extends string>(value: object, key: T): value is object & Record<T, string> {
  return typeof (value as Record<string, unknown>)[key] === 'string'
}
