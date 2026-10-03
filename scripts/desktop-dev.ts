import { installSignalHandlers } from './process-signals'
import path from 'node:path'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const native = Bun.spawnSync({
  cmd: [process.execPath, 'run', '--cwd', 'apps/desktop', 'build:native'],
  cwd: root,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
})
if (native.exitCode !== 0) process.exit(native.exitCode)
const child = Bun.spawn({
  cmd: [process.execPath, 'apps/desktop/src/launcher/index.ts', '--dev'],
  cwd: root,
  env,
  stderr: 'inherit',
  stdout: 'inherit',
})

installSignalHandlers(child)
process.exit(await child.exited)
