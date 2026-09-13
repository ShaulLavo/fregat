const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/
/** Blockquote markers and list indentation in front of a closing fence line. */
const CONTAINER_PREFIX = /^[ \t>]*/u

type OpenFence = {
  readonly char: string
  readonly length: number
}

function openingFence(line: string): OpenFence | null {
  const match = FENCE_LINE.exec(line)
  if (!match?.[1]) return null

  return { char: match[1][0] ?? '`', length: match[1].length }
}

function closesFence(line: string, fence: OpenFence): boolean {
  const bare = line.replace(CONTAINER_PREFIX, '')
  const match = /^(`{3,}|~{3,})/.exec(bare)
  if (!match?.[1]) return false
  if (match[1][0] !== fence.char) return false
  if (match[1].length < fence.length) return false

  return bare.slice(match[0].length).trim().length === 0
}

/**
 * Whether a fenced code node's own source stops before its closing fence. The
 * source is the node's slice of the document, so a fence inside a blockquote
 * still carries the `> ` markers on its lines.
 */
export function isUnclosedFencedCode(source: string): boolean {
  const newline = source.indexOf('\n')
  const firstLine = newline === -1 ? source : source.slice(0, newline)
  const fence = openingFence(firstLine)
  if (!fence) return false
  if (newline === -1) return true

  const lastLine = source.slice(source.lastIndexOf('\n') + 1)

  return !closesFence(lastLine, fence)
}
