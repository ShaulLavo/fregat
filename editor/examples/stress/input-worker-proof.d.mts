export function installInputWorkerProof(negative?: string | null): void
export function replayShikiSource(log: readonly unknown[]): string | null
export function replayTreeSitterSource(log: readonly unknown[]): string | null
export function replayMinimapLines(log: readonly unknown[]): {
  readonly lines: readonly { readonly text: string; readonly length: number }[]
  readonly textLength: number
} | null
export function minimapMatches(
  replayed: ReturnType<typeof replayMinimapLines>,
  text: string,
): boolean
