import { createStructuredError as createDesktopStructuredError } from '@workspace/observability/errors'
import { defineErrorCatalog } from 'evlog'

const desktopErrors = defineErrorCatalog('desktop', {
  INTERNAL_ERROR: {
    status: 500,
    message: ({ message }: { message: string }) => message,
    why: 'A desktop process invariant failed while starting or coordinating Platform.',
    fix: 'Inspect the desktop logs and fix the invariant at the throwing call site.',
  },
})

export function createDesktopError(message: string, cause?: unknown) {
  return createDesktopStructuredError({
    cause,
    code: desktopErrors.INTERNAL_ERROR.code,
    fix: desktopErrors.INTERNAL_ERROR.fix,
    message,
    status: desktopErrors.INTERNAL_ERROR.status,
    why: desktopErrors.INTERNAL_ERROR.why,
  })
}
