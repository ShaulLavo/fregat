export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

export function isPercentage(value: unknown): value is number {
  if (typeof value !== 'number') return false
  if (!Number.isFinite(value)) return false

  return value >= 0 && value <= 100
}
