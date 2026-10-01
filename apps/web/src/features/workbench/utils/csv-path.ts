export function isCsvPath(path: string): boolean {
  return path.toLowerCase().endsWith('.csv')
}
