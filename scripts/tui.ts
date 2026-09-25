import path from 'node:path'

import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import { serverUrlFromEnv } from './runtime-network'

const root = path.resolve(import.meta.dirname, '..')

export async function launchTui({
  args = Bun.argv.slice(2),
  entrypoint = 'src/main.tsx',
}: {
  readonly args?: readonly string[]
  readonly entrypoint?: string
} = {}) {
  const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
  const watch = !args.some(
    (arg) =>
      arg === '--headless-frame' ||
      arg.startsWith('--headless-frame=') ||
      arg === '--help' ||
      arg === '-h',
  )
  env.VITE_SERVER_URL = serverUrlFromEnv(env)
  const child = Bun.spawn({
    cmd: [process.execPath, ...(watch ? ['--watch'] : []), entrypoint, ...args],
    cwd: path.join(root, 'apps/tui'),
    env,
    stdin: 'inherit',
    stderr: 'inherit',
    stdout: 'inherit',
  })

  const removeSignalHandlers = installSignalHandlers(child)
  try {
    return await child.exited
  } finally {
    removeSignalHandlers()
  }
}

function installSignalHandlers(child: ReturnType<typeof Bun.spawn>) {
  const stop = (signal: NodeJS.Signals) => child.kill(signal)

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return () => {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

if (import.meta.main) {
  try {
    process.exit(await launchTui())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
