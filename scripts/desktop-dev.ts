import { installSignalHandlers } from './process-signals'
import path from 'node:path'
import { observabilityEnabledFromEnv } from '../packages/observability/src/env'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const installed = process.argv.includes('--shell=installed')
const output = installed || observabilityEnabledFromEnv(env) ? 'inherit' : 'ignore'
if (installed) {
  const native = Bun.spawnSync({
    cmd: [process.execPath, 'run', '--cwd', 'apps/desktop', 'build:native', '--shell=installed'],
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (native.exitCode !== 0) process.exit(native.exitCode)
}
const child = Bun.spawn({
  cmd: installed
    ? [process.execPath, 'apps/desktop/src/launcher/index.ts', '--dev']
    : [process.execPath, 'run', '--cwd', 'apps/desktop', 'dev'],
  cwd: root,
  env,
  stderr: output,
  stdout: output,
})

installSignalHandlers(child)
process.exit(await child.exited)
