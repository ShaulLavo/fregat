import { createError } from 'evlog'

export function fail(message) {
  throw createError({
    message,
    status: 422,
    data: {
      code: 'EDITOR_STRESS_INVALID',
      why: 'The benchmark contract was not satisfied.',
      fix: 'Inspect the scenario log and rerun with matching fixtures and options.',
    },
  })
}
