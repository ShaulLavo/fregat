import { startSignalingServer } from '../server/signaling'

const [hostname, portText, ...allowedOrigins] = Bun.argv.slice(2)
const port = Number(portText)
if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535 || allowedOrigins.length === 0)
  throw new TypeError(
    'Usage: bun examples/signaling-server.ts <bind-host> <port> <allowed-origin>…',
  )
const server = startSignalingServer({ hostname, port, allowedOrigins })
console.log(`Signaling broker listening on ${server.url}`)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.stop(true)
    process.exit(0)
  })
