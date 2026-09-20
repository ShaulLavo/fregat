export function unique(values: readonly string[]) {
  return Array.from(new Set(values))
}

export function sameItems<T>(left: readonly T[], right: readonly T[]) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}
