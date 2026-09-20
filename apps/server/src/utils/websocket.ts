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
