import path from 'node:path'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import {
  allowedOriginsForWebPort,
  isPortAvailable,
  portFromEnv,
  runtimeUrl,
  selectAvailablePort,
} from './runtime-network'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const turbo = path.join(root, 'node_modules/.bin/turbo')

try {
  await runDev()
} catch (error) {
  console.error(errorMessage(error))
  process.exit(1)
}

async function runDev() {
  const webHost = env.WEB_HOST ?? '127.0.0.1'
  const serverPort = portFromEnv(env, 'PORT', 3001)
  const preferredWebPort = portFromEnv(env, 'WEB_PORT', 5173)
  const webPort = await selectAvailablePort({
    blockedPorts: [serverPort],
    isAvailable: (port) => isPortAvailable(webHost, port),
    preferredPort: preferredWebPort,
  })
  configureRuntime(webHost, webPort)

  const args = Bun.argv.slice(2)
  const command = [turbo, 'dev', ...args]

  console.log(`[dev] Client: ${runtimeUrl(webHost, webPort)}`)
  const child = Bun.spawn({
    cmd: command,
    cwd: root,
    env,
    stderr: 'inherit',
    stdout: 'inherit',
  })

  installSignalHandlers(child)
  process.exit(await child.exited)
}

function configureRuntime(webHost: string, webPort: number) {
  env.WEB_HOST = webHost
  env.WEB_PORT = String(webPort)
  env.SERVER_ALLOWED_ORIGINS = allowedOriginsForWebPort(
    env.SERVER_ALLOWED_ORIGINS,
    webHost,
    webPort,
  )
}

function installSignalHandlers(child: ReturnType<typeof Bun.spawn>) {
  const stop = (signal: NodeJS.Signals) => {
    child.kill(signal)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  return String(error)
}
