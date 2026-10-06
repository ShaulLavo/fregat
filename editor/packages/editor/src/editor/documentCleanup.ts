export function completeDocumentCleanup(cleanups: readonly (() => void)[]): void {
  const failures: unknown[] = []
  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw failures[0]
}
