function number(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null
  const result = Number(value)
  return Number.isFinite(result) && result >= min && result <= max ? result : null
}

function boolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

export function readCredits(
  signals: Readonly<Record<string, string>> | undefined,
): { balance: number; unlimited: boolean } | null | undefined {
  if (!signals) return undefined
  const values = Object.fromEntries(
    Object.entries(signals).map(([name, value]) => [name.toLowerCase(), value]),
  )
  const hasCredits = boolean(values['x-codex-credits-has-credits'])
  const unlimited = boolean(values['x-codex-credits-unlimited'])
  if (hasCredits === undefined || unlimited === undefined) return undefined
  if (!hasCredits && !unlimited) return null
  const balance = number(values['x-codex-credits-balance'], 0, Number.MAX_VALUE)
  return balance === null ? undefined : { balance, unlimited }
}
