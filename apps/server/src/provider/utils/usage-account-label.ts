/** Account metadata supplies presentation only; identities remain independently keyed. */
export function usageAccountLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim().match(/^([A-Za-z0-9][A-Za-z0-9._+-]{0,63})@[^@\s\p{Cc}\p{Cf}]+$/u)?.[1]
}
