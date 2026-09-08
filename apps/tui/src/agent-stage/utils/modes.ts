import type { RuntimeMode } from '@workspace/contracts'

export function nextRuntimeMode(current: RuntimeMode, allowed: readonly RuntimeMode[]) {
  if (allowed.length === 0) return current
  return allowed[(allowed.indexOf(current) + 1) % allowed.length] ?? current
}
