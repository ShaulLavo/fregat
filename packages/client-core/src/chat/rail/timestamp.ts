export function timestampMs(value: string) {
  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? 0 : parsed
}
