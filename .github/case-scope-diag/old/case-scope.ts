import path from 'node:path'
import { readAccounting, type JobAccounting } from './accounting'

const SCOPE_SHIM = path.join(import.meta.dirname, 'scope.sh')

export type CaseScope = {
  readonly unit: string
  readonly memoryMiB: number
  readonly command: readonly string[]
  /** Where the scope shim writes the scope's totals before its last process exits. */
  readonly accountingFile: string
  /** The heavy job's slice; a case that joins it counts against that job's cap and totals. */
  readonly slice?: string
}

/** The argv that runs one bench case in its own memory-capped user scope. */
export function caseScopeCommand(scope: CaseScope) {
  // NOT-PORTABLE: Linux benchmarks require systemd-run and a working user manager.
  if (process.platform !== 'linux') return Array.from(scope.command)
  return [
    'systemd-run',
    '--user',
    '--scope',
    '--quiet', // systemd-run would expand $VAR in the case's arguments; they are paths and must stay as given.
    '--expand-environment=no',
    `--unit=${scope.unit}`,
  ].concat(
    scope.slice ? [`--slice=${scope.slice}`] : [],
    [
      '-p',
      `MemoryMax=${scope.memoryMiB}M`,
      '-p',
      'MemorySwapMax=0', // On OOM the kernel kills the offender alone; systemd's default reaction would stop the
      // scope and, on a second OOM event, SIGKILL the shim before it writes the case's totals.
      '-p',
      'OOMPolicy=continue',
      'bash',
      SCOPE_SHIM,
      scope.accountingFile,
    ],
    scope.command,
  )
}

export type CaseRun = CaseScope & {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdout: string
  readonly stderr: string
  readonly timeoutMs: number
}

export type CaseOutcome = JobAccounting & { readonly exitCode: number }

/**
 * Runs one bench case in its scope. Its totals come from the shim inside the scope: systemd
 * unloads a scope that exited successfully, so `systemctl show` afterwards can find nothing.
 */
export async function runCaseScope(run: CaseRun): Promise<CaseOutcome> {
  const linux = process.platform === 'linux'
  const child = Bun.spawn(caseScopeCommand(run), {
    cwd: run.cwd,
    env: run.env,
    stdout: Bun.file(run.stdout),
    stderr: Bun.file(run.stderr),
  })
  const timeout = setTimeout(() => {
    if (linux) Bun.spawnSync(['systemctl', '--user', 'stop', run.unit])
    else child.kill('SIGTERM')
  }, run.timeoutMs)
  const exitCode = await child.exited
  clearTimeout(timeout)
  // A scope that failed or hit its cap stays loaded until reset.
  if (linux) {
    Bun.spawnSync(['systemctl', '--user', 'stop', run.unit], { stdout: 'ignore', stderr: 'ignore' })
    Bun.spawnSync(['systemctl', '--user', 'reset-failed', run.unit], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
  }
  return { exitCode, ...readAccounting(run.accountingFile) }
}
