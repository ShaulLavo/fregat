export function sortedDirents<T extends { name: string }>(dirents: T[]) {
  return dirents.sort((left, right) => left.name.localeCompare(right.name))
}
