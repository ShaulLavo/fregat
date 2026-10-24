import { connect, type Socket } from 'node:net'

export interface BrokerProbe {
  readonly socket: Socket
  readonly status: number
  readonly headers: string
  readonly messages: unknown[]
  send(frame: unknown): void
}

/** Raw clients can bind distinct loopback addresses and inspect the upgrade headers. */
export async function probe(
  port: number,
  address: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<BrokerProbe> {
  const socket = connect({ host: '127.0.0.1', port, localAddress: address })
  const messages: unknown[] = []
  let buffer = Buffer.alloc(0)
  let upgraded = false
  const response = await new Promise<{ status: number; headers: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new TypeError('Broker probe timed out'))
    }, 5000)
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    socket.once('close', () => {
      clearTimeout(timeout)
      if (!upgraded) reject(new TypeError('Broker closed before responding'))
    })
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end < 0) return
        const text = buffer.subarray(0, end).toString()
        buffer = buffer.subarray(end + 4)
        upgraded = true
        clearTimeout(timeout)
        const status = Number(text.split(' ')[1])
        resolve({ status, headers: text })
        if (status !== 101) {
          socket.end()
          return
        }
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0]! & 15
        let length = buffer[1]! & 127
        let offset = 2
        if (length === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        }
        if (length === 127) {
          if (buffer.length < 10) return
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        if (buffer.length < offset + length) return
        const payload = buffer.subarray(offset, offset + length)
        buffer = buffer.subarray(offset + length)
        if (opcode === 1) messages.push(JSON.parse(payload.toString()))
        if (opcode === 8) socket.end()
      }
    })
    socket.once('connect', () =>
      socket.write(
        [
          'GET / HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Origin: http://collaboration.test',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        ]
          .concat(
            Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
            ['', ''],
          )
          .join('\r\n'),
      ),
    )
  })
  return {
    socket,
    ...response,
    messages,
    send(frame) {
      const payload = Buffer.from(JSON.stringify(frame))
      const size = payload.length < 126 ? 2 : 4
      const prefix = Buffer.alloc(size + 4)
      prefix[0] = 0x81
      prefix[1] = 0x80 | (size === 2 ? payload.length : 126)
      if (size === 4) prefix.writeUInt16BE(payload.length, 2)
      socket.write(Buffer.concat([prefix, payload]))
    },
  }
}
