import { timingSafeEqual } from 'node:crypto'
import { startSignalingServer } from '../server/signaling'

const [hostname, portText, admissionFile, ...allowedOrigins] = Bun.argv.slice(2)
const port = Number(portText)
if (
  !hostname ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !admissionFile ||
  allowedOrigins.length === 0
)
  throw new TypeError(
    'Usage: bun examples/signaling-server.ts <bind-host> <port> <admission-token-file> <allowed-origin>…',
  )
const token = (await Bun.file(admissionFile).text()).trim()
if (!/^[a-zA-Z0-9_-]{43,128}$/.test(token))
  throw new TypeError(
    'The admission file must contain a random base64url token of at least 32 bytes',
  )
const expected = Buffer.from(token)
const server = startSignalingServer({
  hostname,
  port,
  allowedOrigins,
  authorize: (request) =>
    request.headers
      .get('sec-websocket-protocol')
      ?.split(',')
      .some((value) => {
        const candidate = Buffer.from(value.trim())
        return candidate.length === expected.length && timingSafeEqual(candidate, expected)
      }) === true,
  limits: {
    connections: 256,
    connectionsPerIP: 16,
    subscribeTimeout: 5000,
    idleTimeout: 120_000,
    framesPerSecond: 64,
    bytesPerSecond: 2 * 1024 * 1024,
  },
})
console.log(`Signaling broker listening on ${server.url}`)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.stop(true)
    process.exit(0)
  })
