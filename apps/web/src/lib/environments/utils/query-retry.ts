import { errorNumberField } from '@workspace/contracts'

/** One retry for a dropped connection or a server fault; a 4xx answers the same every time. */
export function retryUnlessClientError(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false
  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  return status === undefined || status < 400 || status >= 500
}
