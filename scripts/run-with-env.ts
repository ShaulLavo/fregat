import { installSignalHandlers } from './process-signals'
import { errorMessage } from '../packages/contracts/src/error-fields'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { observabilityEnabledFromEnv } from '../packages/observability/src/env'
import { observabilityEnvFromFile } from '../packages/observability/src/env-file'
import { createScriptError } from './structured-errors'

const root = path.resolve(import.meta.dirname, '..')
const cwd = process.cwd()
const env = observabilityEnvFromFile(path.join(root, '.env'), Bun.env)
// A production terminal carries this; a dev process must never act on production's `pending`.
delete env.PLATFORM_PRODUCTION_ROOT

try {
  const commandArgs = applyEnvAssignments(Bun.argv.slice(2))
  if (commandArgs.length === 0) throw createScriptError('Missing command.')

  const output = observabilityEnabledFromEnv(env) ? 'inherit' : 'ignore'
  const child = Bun.spawn({
    cmd: commandForArgs(commandArgs),
    cwd,
    env,
    stderr: output,
    stdout: output,
  })

  installSignalHandlers(child)
  process.exit(await child.exited)
} catch (error) {
  console.error(errorMessage(error))
  process.exit(1)
}

function applyEnvAssignments(args: string[]) {
  const remaining = [...args]

  while (remaining[0] && isEnvAssignment(remaining[0])) {
    const assignment = remaining.shift()
    if (assignment) applyEnvAssignment(assignment)
  }

  return remaining
}

function isEnvAssignment(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value)
}

function applyEnvAssignment(assignment: string) {
  const separatorIndex = assignment.indexOf('=')
  const key = assignment.slice(0, separatorIndex)
  env[key] = assignment.slice(separatorIndex + 1)
}

function commandForArgs(args: readonly string[]) {
  const [command, ...rest] = args
  if (!command) throw createScriptError('Missing command.')
  if (command.startsWith('-')) return [process.execPath, ...args]

  return [resolveCommand(command), ...rest]
}

function resolveCommand(command: string) {
  if (path.isAbsolute(command) || command.startsWith('.')) return command

  const localBin = path.join(cwd, 'node_modules/.bin', command)
  if (existsSync(localBin)) return localBin

  const rootBin = path.join(root, 'node_modules/.bin', command)
  if (existsSync(rootBin)) return rootBin

  return command
}
