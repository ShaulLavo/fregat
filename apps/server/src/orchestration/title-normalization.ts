export function sanitizeSessionTitle(raw: string) {
  let title = raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'title' in parsed &&
      typeof parsed.title === 'string'
    )
      title = parsed.title
  } catch {
    /* A plain title is the usual provider result. */
  }
  const normalized = title
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!normalized || normalized === 'New thread') return 'New chat'
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117).trimEnd()}…`
}
