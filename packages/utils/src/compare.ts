export function compareValues<T extends number | string>(left: T, right: T) {
  if (left === right) return 0
  return left < right ? -1 : 1
}
