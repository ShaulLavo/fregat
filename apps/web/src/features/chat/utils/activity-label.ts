export function compactActivityLabel(value: string) {
  return value.replace(/\s+(?:started|updated|complete|completed)\s*$/i, '').trim()
}
