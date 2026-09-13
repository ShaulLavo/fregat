import { appendFileSync } from 'node:fs'

type RunOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  /** Append combined output here instead of the terminal. */
  log?: string
}

export type RunResult = { code: number; stdout: string }

export function log(step: string, message: string) {
  console.log(`[deploy] ${step}: ${message}`)
}

/** Runs a command to completion and captures stdout; stderr joins the log or the terminal. */
export async function run(
  command: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const child = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd,
    env: options.env,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (options.log) appendFileSync(options.log, formatLog(command, stdout, stderr, code))
  if (!options.log && stderr) process.stderr.write(stderr)

  return { code, stdout }
}

export async function output(command: readonly string[], cwd = process.cwd()) {
  const result = await run(command, { cwd })
  return result.code === 0 ? result.stdout.trim() : ''
}

function formatLog(command: readonly string[], stdout: string, stderr: string, code: number) {
  return `$ ${command.join(' ')}\n${stdout}${stderr}\n[exit ${code}]\n\n`
}
