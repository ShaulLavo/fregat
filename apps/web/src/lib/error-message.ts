// Never prints String(error): the fallback is caller copy. Siblings keep their own, one renamed:
// fs/watch.ts, lsp/typescript/shared/error.ts, observability runtime.ts, terminalSpawnErrorMessage.
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  return fallback
}
