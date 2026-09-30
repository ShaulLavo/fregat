import { createError, defineErrorCatalog } from 'evlog'

const scriptErrors = defineErrorCatalog('web.scripts', {
  BENCHMARK_FAILED: {
    status: 500,
    message: ({ message }) => message,
    why: 'The web benchmark script could not complete the requested measurement.',
    fix: 'Verify the app server, benchmark page, and benchmark selectors before retrying.',
  },
})

export function createBenchmarkError(message: string) {
  return createError({
    code: scriptErrors.BENCHMARK_FAILED.code,
    fix: scriptErrors.BENCHMARK_FAILED.fix,
    message,
    status: scriptErrors.BENCHMARK_FAILED.status,
    why: scriptErrors.BENCHMARK_FAILED.why,
  })
}
