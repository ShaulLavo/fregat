import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { SETTINGS_REGISTRY } from '../packages/contracts/src/settings/keys'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import { parseSettingsDocument } from '../apps/server/src/settings/json-document'
import { requireFreeDevPorts } from './port-holders'
import { devPorts } from './runtime-network'
import { devStateHome } from './state-home'
import { scriptErrors, scriptFailureText } from './structured-errors'

const IDLE_SETTING = 'developer.devServerIdleMinutes'
const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const ports = devPorts(env)
const route = `:${ports.web}`

try {
  if (Bun.argv.includes('--remove')) await unserve()
  else await serve()
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(1)
}

/**
 * Registers the shared dev server with mesh. Re-running with only a new idle window
 * keeps a running server; a changed command, directory or environment restarts it.
 */
async function serve() {
  // Before mesh takes the ports: anything already there would fail the route on every start.
  if (!(await routeExists())) {
    const all = [ports.web, ports.api, ports.webUpstream, ports.apiUpstream]
    await requireFreeDevPorts('127.0.0.1', all, route)
  }
  const idle = idleMinutes()
  await mesh([
    'serve',
    hostname(),
    '--run',
    'bun run dev:upstream',
    '--cwd',
    root,
    '--listen',
    `${ports.web}=${ports.webUpstream}`,
    '--listen',
    `${ports.api}=${ports.apiUpstream}`,
    '--idle',
    `${idle}m`,
  ])
  console.log(`[dev:serve] ${route} starts on the first connection and stops after ${idle}m idle.`)
}

async function unserve() {
  if (!(await routeExists())) {
    console.log(`[dev:serve] No ${route} route to remove.`)
    return
  }
  await mesh(['unserve', route])
}

async function routeExists() {
  const listing = await meshOutput(['serve', 'ls'])
  return listing.split('\n').some((line) => line.trim().split(/\s+/)[0] === route)
}

/** The dev server's own settings file decides; a missing or invalid value is the registry default. */
function idleMinutes() {
  const descriptor = SETTINGS_REGISTRY[IDLE_SETTING]
  const file = path.join(env.PLATFORM_HOME ?? devStateHome, 'settings.json')
  if (!existsSync(file)) return descriptor.default

  const { values } = parseSettingsDocument(readFileSync(file, 'utf8'))
  const parsed = v.safeParse(descriptor.schema, values[IDLE_SETTING])
  return parsed.success ? parsed.output : descriptor.default
}

async function mesh(args: readonly string[]) {
  const child = Bun.spawn({ cmd: ['mesh', ...args], stderr: 'inherit', stdout: 'inherit' })
  const exitCode = await child.exited
  if (exitCode === 0) return
  throw scriptErrors.MESH_FAILED({ command: args.join(' '), exitCode })
}

async function meshOutput(args: readonly string[]) {
  const child = Bun.spawn({ cmd: ['mesh', ...args], stderr: 'inherit', stdout: 'pipe' })
  const output = await new Response(child.stdout).text()
  const exitCode = await child.exited
  if (exitCode === 0) return output
  throw scriptErrors.MESH_FAILED({ command: args.join(' '), exitCode })
}
