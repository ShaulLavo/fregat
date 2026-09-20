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

export function errorSummary(error: unknown) {
  if (error instanceof Error) {
    return {
      code: errorStringField(error, 'code'),
      message: error.message,
      name: error.name,
      status: errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status'),
    }
  }

  return {
    message: String(error),
    name: typeof error,
  }
}

export function nodeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  const code = error.code
  return typeof code === 'string' ? code : null
}
