import { createError } from '@singapore-editor/core/logging/evlog'

type PendingState = () => Readonly<Record<string, unknown>>

function timeoutError(stage: string, observe: PendingState) {
  const pending = observe()
  return createError({
    message: `Input readiness deadline expired at ${stage}: ${JSON.stringify(pending)}`,
    status: 422,
    code: 'EDITOR_STRESS_READINESS_TIMEOUT',
    why: 'A consumer did not finish its readiness or cleanup stage.',
    fix: 'Inspect the consumer stage and pending state in the scenario error.',
    internal: { stage, pending },
  })
}

export function awaitInputStage<T>(
  stage: string,
  deadline: number,
  observe: PendingState,
  operation: () => Promise<T>,
): Promise<T> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) return Promise.reject(timeoutError(stage, observe))
  let timer: ReturnType<typeof setTimeout>
  return new Promise<T>((resolve, reject) => {
    // @justification Harness readiness and cleanup only: the shared deadline bounds worker awaits
    // outside captured input; the timer is cleared when the stage settles.
    timer = setTimeout(() => reject(timeoutError(stage, observe)), remaining)
    Promise.resolve().then(operation).then(resolve, reject)
  }).finally(() => clearTimeout(timer))
}

export function inputReadyDelay(ms: number): Promise<void> {
  // @justification Harness readiness only: polling yields for states without a completion event,
  // outside captured input and within the caller's absolute deadline.
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForInputReady(
  stage: string,
  deadline: number,
  settled: () => boolean,
  observe: PendingState,
) {
  while (!settled()) await awaitInputStage(stage, deadline, observe, () => inputReadyDelay(16))
}
