import { timingSafeEqual } from 'node:crypto'
import { startSignalingServer, type Admission } from '../server/signaling'

export function memberAdmission(contents: string): (request: Request) => Admission {
  const members = new Set<string>()
  const tokens = new Set<string>()
  const entries = contents
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [member, token, extra] = line.trim().split(/\s+/)
      if (
        !member ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(member) ||
        !token ||
        !/^[a-zA-Z0-9_-]{43,128}$/.test(token) ||
        extra ||
        members.has(member) ||
        tokens.has(token)
      )
        throw new TypeError(
          'The admission file requires unique member token lines with random base64url tokens of at least 32 bytes',
        )
      members.add(member)
      tokens.add(token)
      return { member, expected: Buffer.from(token) }
    })
  return (request) => {
    const candidates = (request.headers.get('sec-websocket-protocol') ?? '')
      .split(',')
      .map((value) => Buffer.from(value.trim()))
    let admission: Admission = false
    for (const { member, expected } of entries) {
      const matches = candidates.some(
        (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
      )
      if (matches) admission = { member }
    }
    return admission
  }
}

if (import.meta.main) {
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
  const server = startSignalingServer({
    hostname,
    port,
    allowedOrigins,
    authorize: memberAdmission(await Bun.file(admissionFile).text()),
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
}
