import { clientErrors } from '@/lib/structured-errors'

// An assertion, so the caller keeps the hook's own return and the compiler still treats it as frozen.
export function requireContext<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) throw clientErrors.CONTEXT_MISSING({ message })
}
