import { EvlogError } from 'evlog'
import { errorMessage } from '@workspace/contracts'
import { launcherErrors } from './structured-errors'

export function launcherFailureFacts(error: unknown) {
  const failure =
    error instanceof EvlogError
      ? error
      : launcherErrors.LAUNCH_FAILED({
          internal: { reason: 'unclassified-failure', errorType: typeof error },
        })
  return {
    error: errorMessage(failure),
    code: failure.code,
    why: failure.why,
    fix: failure.fix,
    internal: failure.internal,
  }
}

export function reportStartFailure(
  error: unknown,
  output: {
    log(facts: ReturnType<typeof launcherFailureFacts>): void
    stderr(line: string): void
    exit(code: number): void
  },
) {
  const facts = launcherFailureFacts(error)
  output.log(facts)
  output.stderr(JSON.stringify({ event: 'desktop.start_failed', ...facts }))
  output.exit(1)
}
