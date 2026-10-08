import { startSignalingServer } from '../server/signaling'

const origin = process.argv[2]
if (!origin) throw new TypeError('Test origin required')
const server = startSignalingServer({
  hostname: '127.0.0.1',
  port: 0,
  allowedOrigins: [origin],
  authorize: (request) => request.headers.get('sec-websocket-protocol') === 'fixture-admission',
  limits: {
    connections: 16,
    connectionsPerIP: 16,
    subscribeTimeout: 3000,
    idleTimeout: 30_000,
    framesPerSecond: 128,
    bytesPerSecond: 2 * 1024 * 1024,
  },
})
console.log(JSON.stringify({ url: `ws://127.0.0.1:${server.port}` }))
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.stop(true)
    process.exit(0)
  })
