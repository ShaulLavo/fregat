import { createError } from 'evlog'

export function stressError(message: string) {
  return createError({
    message,
    status: 422,
    data: {
      code: 'EDITOR_STRESS_INVALID',
      why: 'The benchmark contract was not satisfied.',
      fix: 'Inspect the scenario log and rerun with matching fixtures and options.',
    },
  })
}

export function fail(message: string): never {
  throw stressError(message)
}
