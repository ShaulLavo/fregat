import { createScriptError } from '../structured-errors'

export async function withProductionDeadline<T>(
  promise: Promise<T>,
  operation: string,
  milliseconds = 45_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          createScriptError(`The production probe timed out during ${operation}.`, {
            internal: { operation, milliseconds },
          }),
        ),
      milliseconds,
    )
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    clearTimeout(timer)
  }
}
