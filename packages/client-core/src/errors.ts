import { createError, type ErrorOptions } from 'evlog'

export type ClientStructuredErrorOptions = Omit<ErrorOptions, 'cause'> & {
  readonly cause?: unknown
}

// An Error stays on `cause`; anything else (an Eden envelope, a string) goes to `internal.cause`,
// like the other structured-error wrappers.
export function createClientError({ cause, ...options }: ClientStructuredErrorOptions) {
  if (cause === undefined || cause instanceof Error) return createError({ ...options, cause })
  return createError({ ...options, internal: { ...options.internal, cause } })
}
