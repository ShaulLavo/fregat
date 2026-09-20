import { installSignalHandlers } from './process-signals'
import path from 'node:path'
import { observabilityEnabledFromEnv } from '../packages/observability/src/env'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'

const root = path.resolve(import.meta.dirname, '..')
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
const output = observabilityEnabledFromEnv(env) ? 'inherit' : 'ignore'
const child = Bun.spawn({
  cmd: [process.execPath, 'run', '--cwd', 'apps/desktop', 'dev:standalone'],
  cwd: root,
  env,
  stderr: output,
  stdout: output,
})

installSignalHandlers(child)
process.exit(await child.exited)
