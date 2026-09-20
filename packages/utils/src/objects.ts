export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}
