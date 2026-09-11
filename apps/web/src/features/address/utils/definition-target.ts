import type { Address } from '@workspace/client-core/address/grammar'

export function definitionTargetFor(path: string, focus: NonNullable<Address['focus']>) {
  const line = focus.line - 1
  const character = (focus.column ?? 1) - 1
  const endLine = focus.endLine ? Math.max(line, focus.endLine - 1) : line
  return {
    path,
    range: {
      end: { character: focus.endLine ? 0 : character, line: endLine },
      start: { character, line },
    },
    uri: `file://${path.startsWith('/') ? path : `/${path}`}`,
  }
}
