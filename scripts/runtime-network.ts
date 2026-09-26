import { unique } from '@workspace/utils/collections'
import net from 'node:net'

import { TUI_CLIENT_ORIGIN } from '../packages/contracts/src/client-origins'
import { createScriptError } from './structured-errors'

const MAX_PORT_ATTEMPTS = 100

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'] as const

type RuntimeEnv = Readonly<Record<string, string | undefined>>

type AvailablePortOptions = {
  blockedPorts?: readonly number[]
  isAvailable: (port: number) => Promise<boolean>
  preferredPort: number
}

export async function selectAvailablePort(options: AvailablePortOptions) {
  const blockedPorts = new Set(options.blockedPorts)

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = options.preferredPort + offset
    if (port > 65_535) break
    if (blockedPorts.has(port)) continue
    if (await options.isAvailable(port)) return port
  }

  throw createScriptError(
    `Could not find an available port at or above ${options.preferredPort} after ${MAX_PORT_ATTEMPTS} attempts.`,
  )
}

export function isPortAvailable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ exclusive: true, host, port }, () => closePortProbe(server, resolve))
  })
}

export function portFromEnv(env: RuntimeEnv, name: string, fallback: number) {
  const value = env[name]
  if (!value) return fallback

  const port = Number(value)
  if (Number.isInteger(port) && port > 0 && port < 65_536) return port

  throw createScriptError(`${name} must be an integer between 1 and 65535.`)
}

/** Mesh's upstream for a public dev port; one rule so dev.ts and dev-serve.ts cannot drift. */
const UPSTREAM_PORT_OFFSET = 10_000

/** The dev pair's ports: public ones clients use, upstream ones the pair binds behind mesh. */
export function devPorts(env: RuntimeEnv) {
  const web = portFromEnv(env, 'WEB_PORT', 5173)
  const api = portFromEnv(env, 'PORT', 3001)
  return {
    web,
    api,
    webUpstream: web + UPSTREAM_PORT_OFFSET,
    apiUpstream: api + UPSTREAM_PORT_OFFSET,
  }
}

export function runtimeUrl(host: string, port: number) {
  return `http://${urlHost(host)}:${port}`
}

/** The API server a dev process talks to: `VITE_SERVER_URL`, else the server's host and port. */
export function serverUrlFromEnv(env: RuntimeEnv) {
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL

  return runtimeUrl(env.FS_HOST ?? env.HOST ?? '127.0.0.1', portFromEnv(env, 'PORT', 3001))
}

/** `SERVER_ALLOWED_ORIGINS` for a page served at the web port; the server allows nothing else. */
export function allowedOriginsForWebPort(
  configuredOrigins: string | undefined,
  webHost: string,
  webPort: number,
) {
  return webOrigins(configuredOrigins, webHost, webPort).join(',')
}

// The origin guard is exact, so register both loopback spellings and the TUI origin.
function webOrigins(configuredOrigins: string | undefined, webHost: string, webPort: number) {
  return unique([
    ...browserOriginsForWebPort(webHost, webPort),
    TUI_CLIENT_ORIGIN,
    ...originsFromEnv(configuredOrigins),
  ])
}

function closePortProbe(server: net.Server, resolve: (available: boolean) => void) {
  server.close(() => resolve(true))
}

function browserOriginsForWebPort(webHost: string, webPort: number) {
  const configured = runtimeUrl(webHost, webPort)
  if (!isLoopbackHost(webHost)) return [configured]

  return [configured, ...LOOPBACK_HOSTS.map((host) => runtimeUrl(host, webPort))]
}

function isLoopbackHost(host: string) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function originsFromEnv(value: string | undefined) {
  if (!value) return []

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function urlHost(host: string) {
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`

  return host
}
