import { createError, type ErrorOptions } from 'evlog'
type StructuredErrorOptions = Omit<ErrorOptions, 'cause'> & { cause?: unknown }
export function createStructuredError(options: StructuredErrorOptions) {
  const { cause, ...rest } = options

  return createError({
    ...rest,
    ...(cause instanceof Error ? { cause } : {}),
    ...(cause === undefined || cause instanceof Error ? {} : { internal: { cause } }),
  })
}
