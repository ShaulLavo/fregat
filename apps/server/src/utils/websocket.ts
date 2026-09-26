import { isRecord } from '@workspace/utils/objects'
export function adaptWebSocket(value: unknown) {
  if (!isRecord(value) || typeof value.send !== 'function') return null
  const close = value.close
  const send = value.send
  return {
    close: (code?: number, reason?: string) =>
      typeof close === 'function' ? close.call(value, code, reason) : undefined,
    data: value.data,
    key: isRecord(value.raw) ? value.raw : value,
    send: (message: string | Uint8Array) => send.call(value, message),
  }
}

/** Elysia's parsed `query` first, then the upgrade URL; a malformed URL reads as absent. */
export function webSocketQueryValue(data: unknown, key: string): string | null {
  if (!isRecord(data)) return null
  const parsed = isRecord(data.query) ? data.query[key] : undefined
  if (typeof parsed === 'string') return parsed
  if (typeof data.url !== 'string') return null

  try {
    return new URL(data.url).searchParams.get(key)
  } catch {
    return null
  }
}

/** 1000 normal, 1001 going away, 1005 no code given: the closes a healthy client makes. */
const ORDINARY_CLOSE_CODES = new Set([1000, 1001, 1005])

/** Abnormal closes are warnings, so production's info sampling cannot drop the evidence. */
export function isAbnormalWebSocketClose(code: number | undefined): boolean {
  return code === undefined || !ORDINARY_CLOSE_CODES.has(code)
}
