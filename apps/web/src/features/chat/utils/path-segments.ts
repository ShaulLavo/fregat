export function pathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0)
}
