import { existsSync } from 'node:fs'

export async function launchHost(argv: readonly string[], env: NodeJS.ProcessEnv) {
  const scoped = await canUseSystemdScope(env)
  const command = scoped
    ? [
        'systemd-run',
        '--user',
        '--scope',
        '--collect',
        '--quiet',
        `--unit=platform-pty-${crypto.randomUUID()}`,
        '--',
        ...argv,
      ]
    : [...argv]
  const child = Bun.spawn(command, { env, detached: true, stdio: ['ignore', 'ignore', 'ignore'] })
  child.unref()
}

async function canUseSystemdScope(env: NodeJS.ProcessEnv) {
  if (process.platform !== 'linux' || !existsSync('/run/systemd/system')) return false
  if (!(await probe(['systemd-run', '--version'], env))) return false
  return probe(['systemctl', '--user', 'show-environment'], env)
}

async function probe(command: string[], env: NodeJS.ProcessEnv) {
  try {
    const child = Bun.spawn(command, { env, stdio: ['ignore', 'ignore', 'ignore'] })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 1_000)
    const exit = await child.exited
    clearTimeout(timeout)
    return exit === 0
  } catch {
    return false
  }
}
