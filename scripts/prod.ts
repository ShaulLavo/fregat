import { existsSync } from 'node:fs'
import path from 'node:path'
import { portFromEnv, runtimeUrl } from './runtime-network'
import { createScriptError } from './structured-errors'

type Mode = 'all' | 'build' | 'start'

const root = path.resolve(import.meta.dirname, '..')
const webRoot = path.join(root, 'apps/web/dist')
const serverBundle = path.join(root, 'apps/server/dist/index.js')
const productionEnv = { ...Bun.env, BUN_ENV: 'production', NODE_ENV: 'production' }

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

async function main() {
  const mode = parseMode(Bun.argv[2])
  if (mode !== 'start') await buildProd()
  if (mode !== 'build') await startProd()
}

async function buildProd() {
  console.log('[prod] Building production artifacts')
  const code = await runCommand('build', ['bun', 'run', 'turbo', 'build'], productionEnv)
  if (code === 0) return

  process.exit(code)
}

// One server serves the page and the API; the page derives the API address from its own URL.
async function startProd() {
  ensureBuildArtifact('server', serverBundle)
  ensureBuildArtifact('client', path.join(webRoot, 'index.html'))
  const host = Bun.env.FS_HOST ?? Bun.env.HOST ?? '127.0.0.1'
  const port = portFromEnv(Bun.env, 'PORT', 3001)
  console.log(`[prod] Platform: ${runtimeUrl(host, port)}`)

  const child = spawnProcess('server', ['bun', serverBundle], {
    ...productionEnv,
    PORT: String(port),
    WEB_ROOT: webRoot,
  })
  installSignalHandlers(child)
  process.exit(await child.exited)
}

function parseMode(value: string | undefined): Mode {
  if (!value) return 'all'
  if (value === 'all' || value === 'build' || value === 'start') return value

  throw createScriptError(`Unknown production mode "${value}". Use build, start, or all.`)
}

function ensureBuildArtifact(label: string, artifactPath: string) {
  if (existsSync(artifactPath)) return

  throw createScriptError(
    `Missing ${label} production artifact at ${path.relative(root, artifactPath)}. ` +
      'Run `bun run build` first, or use `bun run prod`.',
  )
}

function spawnProcess(name: string, command: string[], env: Record<string, string | undefined>) {
  console.log(`[prod] ${name}: ${command.join(' ')}`)
  return Bun.spawn({ cmd: command, cwd: root, env, stderr: 'inherit', stdout: 'inherit' })
}

async function runCommand(
  name: string,
  command: string[],
  env: Record<string, string | undefined>,
) {
  return await spawnProcess(name, command, env).exited
}

function installSignalHandlers(child: ReturnType<typeof Bun.spawn>) {
  const stop = (signal: NodeJS.Signals) => {
    child.kill(signal)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
