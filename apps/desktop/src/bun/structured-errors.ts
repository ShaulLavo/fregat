import { createError, defineErrorCatalog, type ErrorOptions } from 'evlog'

type DesktopStructuredErrorOptions = Omit<ErrorOptions, 'cause'> & {
  cause?: unknown
}

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

function createDesktopStructuredError(options: DesktopStructuredErrorOptions) {
  const { cause, ...rest } = options

  return createError({
    ...rest,
    ...(cause instanceof Error ? { cause } : {}),
    ...(cause === undefined || cause instanceof Error ? {} : { internal: { cause } }),
  })
}
