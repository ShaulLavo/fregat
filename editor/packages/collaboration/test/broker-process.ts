import { startSignalingServer } from '../server/signaling'

const origin = process.argv[2]
if (!origin) throw new TypeError('Test origin required')
const server = startSignalingServer({ hostname: '127.0.0.1', port: 0, allowedOrigins: [origin] })
console.log(JSON.stringify({ url: `ws://127.0.0.1:${server.port}` }))
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.stop(true)
    process.exit(0)
  })
