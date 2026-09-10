import type { ServerWebSocket } from 'bun'
import { isRecord } from '@workspace/contracts'

import { recordProcessWarning } from '../observability'

type RelayClient = Pick<ServerWebSocket<unknown>, 'send' | 'close'>
type RelayFrame = string | Buffer

const maxBufferedBytes = 16 * 1024 * 1024

// lib.dom hides Bun's header-capable constructor; this module only runs in Bun.
const NativeWebSocket = WebSocket as typeof WebSocket & {
  new (url: URL, options: Bun.WebSocketOptions): Bun.WebSocket
}

export function createMachineProxySocket(target: URL, headers: Headers, machineName: string) {
  let upstream: Bun.WebSocket | null = null
  let pending: RelayFrame[] = []
  let pendingBytes = 0
  let closed = false

  function stop(client: RelayClient, code = 1000, reason = '') {
    if (closed) return
    closed = true
    pending = []
    pendingBytes = 0
    client.close(code, reason)
    upstream?.close(code, reason)
  }

  function open(client: RelayClient) {
    const remote = new NativeWebSocket(target, { headers: Object.fromEntries(headers) })
    upstream = remote
    remote.binaryType = 'arraybuffer'
    remote.onopen = () => {
      if (closed) return remote.close()
      pending.forEach((frame) => remote.send(frame))
      pending = []
      pendingBytes = 0
    }
    remote.onmessage = (event: unknown) => {
      if (!isRecord(event)) return
      const frame = event.data
      if (typeof frame !== 'string' && !(frame instanceof ArrayBuffer)) return
      if (client.send(frame) === 0) stop(client, 1013, 'Machine connection is congested')
    }
    remote.onerror = () => {
      recordProcessWarning('machine.proxy.failed', {
        area: 'machines',
        machineName,
        operation: 'proxy',
        transport: 'websocket',
      })
      stop(client, 1011, 'Machine connection failed')
    }
    remote.onclose = ({ code, reason }) => stop(client, relayCloseCode(code), reason)
  }

  function message(client: RelayClient, frame: RelayFrame) {
    if (closed) return
    if (upstream?.readyState !== WebSocket.OPEN) {
      queue(client, frame)
      return
    }
    upstream.send(frame)
    if (upstream.bufferedAmount > maxBufferedBytes) {
      stop(client, 1013, 'Machine connection is congested')
    }
  }

  function queue(client: RelayClient, frame: RelayFrame) {
    pendingBytes += typeof frame === 'string' ? Buffer.byteLength(frame) : frame.byteLength
    if (pendingBytes > maxBufferedBytes) return stop(client, 1009, 'Too much queued input')
    pending.push(frame)
  }

  return {
    open,
    message,
    close: (client: RelayClient, code: number, reason: string) =>
      stop(client, relayCloseCode(code), reason),
  }
}

function relayCloseCode(code: number) {
  if (code === 1005) return 1000
  if (code === 1006 || code === 1015) return 1011
  return code
}
