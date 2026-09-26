import { installSignalHandlers } from './process-signals'
import path from 'node:path'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import { requireFreeDevPorts } from './port-holders'
import { allowedOriginsForWebPort, devPorts, runtimeUrl } from './runtime-network'
import { devStateHome, seedDevStateHome } from './state-home'
import { scriptFailureText } from './structured-errors'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const turbo = path.join(root, 'node_modules/.bin/turbo')
// Mesh proxies only IPv4 loopback, and an upstream bound on `::1` alone would never read as ready.
const UPSTREAM_HOST = '127.0.0.1'
const UPSTREAM_FLAG = '--upstream'

try {
  await runDev()
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(1)
}

/**
 * `bun run dev` binds the public ports itself. `--upstream` is the mesh route's recipe: the pair
 * binds the upstream ports and mesh owns the public ones (`scripts/dev-serve.ts`).
 */
async function runDev() {
  const upstream = Bun.argv.includes(UPSTREAM_FLAG)
  const args = Bun.argv.slice(2).filter((arg) => arg !== UPSTREAM_FLAG)
  const ports = devPorts(env)
  const webHost = upstream ? UPSTREAM_HOST : (env.WEB_HOST ?? UPSTREAM_HOST)
  const webPort = upstream ? ports.webUpstream : ports.web
  const apiPort = upstream ? ports.apiUpstream : ports.api
  const dryRun = isDryRun(args)
  if (!dryRun) await requireFreeDevPorts(webHost, [webPort, apiPort], `:${ports.web}`)

  configureRuntime({ webHost, webPort, apiPort, publicWebPort: ports.web, upstream })
  configureStateHome(dryRun)

  console.log(`[dev] Client: ${runtimeUrl(webHost, ports.web)}`)
  const child = Bun.spawn({
    cmd: [turbo, 'dev', ...args],
    cwd: root,
    env,
    stderr: 'inherit',
    stdout: 'inherit',
  })

  installSignalHandlers(child)
  process.exit(await child.exited)
}

type Runtime = {
  webHost: string
  webPort: number
  apiPort: number
  publicWebPort: number
  upstream: boolean
}

function configureRuntime(runtime: Runtime) {
  env.WEB_HOST = runtime.webHost
  env.WEB_PORT = String(runtime.webPort)
  env.PORT = String(runtime.apiPort)
  if (runtime.upstream) env.FS_HOST = UPSTREAM_HOST
  // The page's origin is the public port; the upstream one is Vite's own origin for app saves.
  const upstreamOrigins = allowedOriginsForWebPort(
    env.SERVER_ALLOWED_ORIGINS,
    runtime.webHost,
    runtime.webPort,
  )
  env.SERVER_ALLOWED_ORIGINS = allowedOriginsForWebPort(
    upstreamOrigins,
    runtime.webHost,
    runtime.publicWebPort,
  )
}

/** Dev never opens production's `~/.platform`; see `scripts/state-home.ts`. */
function configureStateHome(dryRun: boolean) {
  env.PLATFORM_HOME ??= devStateHome
  if (!dryRun && seedDevStateHome(env.PLATFORM_HOME))
    console.log(`[dev] Seeded ${env.PLATFORM_HOME}`)
  console.log(`[dev] State: ${env.PLATFORM_HOME}`)
}

/** Turbo's `--dry`/`--dry-run` only prints the task graph, so nothing is seeded (CI has no `/work`). */
function isDryRun(args: readonly string[]) {
  return args.some((arg) => /^--dry(-run)?(=|$)/.test(arg))
}
