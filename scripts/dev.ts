import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { installSignalHandlers } from './process-signals'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import { requireFreeDevPorts } from './port-holders'
import { allowedOriginsForWebPort, devPorts, runtimeUrl } from './runtime-network'
import { defaultDevStateHome, seedDevStateHome } from './state-home'
import { scriptFailureText } from './structured-errors'

const root = path.resolve(import.meta.dirname, '..')
const turbo = path.join(root, 'node_modules/.bin/turbo')
// Mesh proxies only IPv4 loopback, and an upstream bound on `::1` alone would never read as ready.
const UPSTREAM_HOST = '127.0.0.1'
const UPSTREAM_FLAG = '--upstream'
const DIRECT_FLAG = '--direct'
const STOP_GRACE_MS = 5_000

export type DirectDevProcess = {
  readonly taskId: 'server#dev' | 'web#dev'
  readonly cwd: string
  readonly cmd: readonly string[]
}

export function shouldUseDirectDev(options: {
  readonly argv: readonly string[]
  readonly arch?: string
  readonly turboPath?: string
  readonly exists?: (file: string) => boolean
}) {
  if (options.argv.includes(DIRECT_FLAG)) return true
  if ((options.arch ?? process.arch) === 'wasm32') return true
  const check = options.exists ?? existsSync
  return !check(options.turboPath ?? turbo)
}

export function resolveViteEntry(workspaceRoot = root) {
  const webRequire = createRequire(path.join(workspaceRoot, 'apps/web/package.json'))
  return path.join(path.dirname(webRequire.resolve('vite/package.json')), 'bin/vite.js')
}

export function directDevProcesses(
  workspaceRoot = root,
  execPath = process.execPath,
  viteEntry = resolveViteEntry(workspaceRoot),
): readonly DirectDevProcess[] {
  return [
    {
      taskId: 'server#dev',
      cwd: path.join(workspaceRoot, 'apps/server'),
      cmd: [execPath, 'src/index.ts'],
    },
    {
      taskId: 'web#dev',
      cwd: path.join(workspaceRoot, 'apps/web'),
      cmd: [execPath, viteEntry],
    },
  ]
}

if (import.meta.main) {
  try {
    await runDev()
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exit(1)
  }
}

/**
 * `bun run dev` binds the public ports itself. `--upstream` is the mesh route's recipe: the pair
 * binds the upstream ports and mesh owns the public ones (`scripts/dev-serve.ts`).
 */
async function runDev() {
  const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
  const rawArgs = Bun.argv.slice(2)
  const upstream = rawArgs.includes(UPSTREAM_FLAG)
  const direct = shouldUseDirectDev({ argv: rawArgs })
  const args = rawArgs.filter((arg) => arg !== UPSTREAM_FLAG && arg !== DIRECT_FLAG)
  const ports = devPorts(env)
  const webHost = upstream ? UPSTREAM_HOST : (env.WEB_HOST ?? UPSTREAM_HOST)
  const webPort = upstream ? ports.webUpstream : ports.web
  const apiPort = upstream ? ports.apiUpstream : ports.api
  const dryRun = isDryRun(args)
  if (!dryRun) await requireFreeDevPorts(webHost, [webPort, apiPort], `:${ports.web}`)

  configureRuntime(env, { webHost, webPort, apiPort, publicWebPort: ports.web, upstream })
  configureStateHome(env, dryRun)

  console.log(`[dev] Client: ${runtimeUrl(webHost, ports.web)}`)
  if (direct) {
    process.exit(await runDirectDev(env, args, dryRun))
  }

  const child = Bun.spawn({
    cmd: [turbo, 'dev', '--filter=web', '--filter=server', '--filter=desktop'].concat(args),
    cwd: root,
    env,
    stderr: 'inherit',
    stdout: 'inherit',
  })

  installSignalHandlers(child)
  process.exit(await child.exited)
}

async function runDirectDev(
  env: Record<string, string | undefined>,
  args: readonly string[],
  dryRun: boolean,
) {
  const processes = directDevProcesses(root)
  if (dryRun) {
    if (isDryJson(args)) {
      console.log(JSON.stringify({ tasks: processes.map(({ taskId }) => ({ taskId })) }, null, 2))
      return 0
    }
    for (const entry of processes) console.log(`[dev] ${entry.taskId}: ${entry.cmd.join(' ')}`)
    return 0
  }

  // A production terminal carries this; a dev process must never act on production's `pending`.
  delete env.PLATFORM_PRODUCTION_ROOT

  return superviseDirectProcesses(processes, env)
}

export async function superviseDirectProcesses(
  processes: readonly DirectDevProcess[],
  env: Record<string, string | undefined>,
  stopGraceMs = STOP_GRACE_MS,
) {
  const children: ReturnType<typeof Bun.spawn>[] = []
  try {
    for (const entry of processes) {
      children.push(
        Bun.spawn({
          cmd: Array.from(entry.cmd),
          cwd: entry.cwd,
          env,
          stderr: 'inherit',
          stdout: 'inherit',
        }),
      )
    }
  } catch (error) {
    stopChildren(children, 'SIGTERM')
    await Promise.all(children.map((child) => waitOrKill(child, stopGraceMs)))
    throw error
  }

  const signaled = Promise.withResolvers<NodeJS.Signals>()
  const onSignal = (signal: NodeJS.Signals) => {
    signaled.resolve(signal)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  type SupervisorOutcome =
    | { readonly kind: 'signal'; readonly signal: NodeJS.Signals }
    | { readonly kind: 'exit'; readonly code: number }

  try {
    const signalRace: Promise<SupervisorOutcome>[] = [
      signaled.promise.then((signal) => ({ kind: 'signal' as const, signal })),
    ]
    const outcome = await Promise.race(
      signalRace.concat(
        children.map((child) => child.exited.then((code) => ({ kind: 'exit' as const, code }))),
      ),
    )
    stopChildren(children, outcome.kind === 'signal' ? outcome.signal : 'SIGTERM')
    await Promise.all(children.map((child) => waitOrKill(child, stopGraceMs)))
    return outcome.kind === 'signal' ? 0 : outcome.code
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

function stopChildren(children: readonly ReturnType<typeof Bun.spawn>[], signal: NodeJS.Signals) {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

async function waitOrKill(child: ReturnType<typeof Bun.spawn>, stopGraceMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(stopGraceMs)])
  if (exited) return
  child.kill('SIGKILL')
  await child.exited
}

type Runtime = {
  webHost: string
  webPort: number
  apiPort: number
  publicWebPort: number
  upstream: boolean
}

function configureRuntime(env: Record<string, string | undefined>, runtime: Runtime) {
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
function configureStateHome(env: Record<string, string | undefined>, dryRun: boolean) {
  env.PLATFORM_HOME ??= defaultDevStateHome()
  if (!dryRun && seedDevStateHome(env.PLATFORM_HOME))
    console.log(`[dev] Seeded ${env.PLATFORM_HOME}`)
  console.log(`[dev] State: ${env.PLATFORM_HOME}`)
}

/** Turbo's `--dry`/`--dry-run` only prints the task graph, so nothing is seeded (CI has no `/work`). */
function isDryRun(args: readonly string[]) {
  return args.some((arg) => /^--dry(-run)?(=|$)/.test(arg))
}

function isDryJson(args: readonly string[]) {
  return args.some((arg) => /^--dry(-run)?=json$/.test(arg))
}
