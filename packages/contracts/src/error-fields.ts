import { isObject } from '@workspace/utils/objects'
export type ErrorStringFieldOptions = {
  maxLength?: number
  preserve?: 'end' | 'start'
}

export function errorStringField(
  error: unknown,
  field: string,
  options: ErrorStringFieldOptions = {},
) {
  const value = errorFieldValue(error, field)
  if (typeof value !== 'string') return undefined

  return limitErrorStringField(value, options)
}

export function errorNumberField(error: unknown, field: string) {
  const value = errorFieldValue(error, field)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorFieldValue(error: unknown, field: string) {
  if (!isObject(error)) return undefined
  if (!(field in error)) return undefined

  return error[field]
}

function limitErrorStringField(value: string, options: ErrorStringFieldOptions) {
  if (options.maxLength === undefined) return value

  const maxLength = Math.max(0, options.maxLength)
  if (value.length <= maxLength) return value
  if (options.preserve === 'end') return value.slice(Math.max(0, value.length - maxLength))

  return value.slice(0, maxLength)
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  return String(error)
}

export type ErrorSummaryOptions = {
  /** Applies to `message`, `fix` and `why`; omitted keeps them whole. */
  readonly limit?: ErrorStringFieldOptions
  /** Adds the catalog's `fix` and `why`, which the RPC wire form leaves out. */
  readonly guidance?: boolean
}

export function errorSummary(error: unknown, options: ErrorSummaryOptions = {}) {
  const code = errorStringField(error, 'code')
  // `statusCode` first, the server's order, so both ends of one request log the same number.
  const status = errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status')
  const limit = options.limit ?? {}
  if (!(error instanceof Error)) {
    return {
      code,
      message: limitErrorStringField(String(error), limit),
      name: typeof error,
      status,
    }
  }

  return {
    code,
    ...(options.guidance ? errorGuidance(error, limit) : {}),
    message: limitErrorStringField(error.message, limit),
    name: error.name,
    status,
  }
}

function errorGuidance(error: Error, limit: ErrorStringFieldOptions) {
  return { fix: errorStringField(error, 'fix', limit), why: errorStringField(error, 'why', limit) }
}

export function nodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  const code = error.code
  return typeof code === 'string' ? code : null
}
