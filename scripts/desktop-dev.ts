import { installSignalHandlers } from './process-signals'
import path from 'node:path'
import { observabilityEnabledFromEnv } from '../packages/observability/src/env'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const polaron = process.argv.includes('--shell=polaron')
const output = polaron || observabilityEnabledFromEnv(env) ? 'inherit' : 'ignore'
if (polaron) {
  const native = Bun.spawnSync({
    cmd: [process.execPath, 'run', '--cwd', 'apps/desktop', 'build:native'],
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (native.exitCode !== 0) process.exit(native.exitCode)
}
const child = Bun.spawn({
  cmd: polaron
    ? [process.execPath, 'apps/desktop/src/launcher/index.ts', '--dev']
    : [process.execPath, 'run', '--cwd', 'apps/desktop', 'dev'],
  cwd: root,
  env,
  stderr: output,
  stdout: output,
})

installSignalHandlers(child)
process.exit(await child.exited)
