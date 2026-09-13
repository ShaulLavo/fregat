const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/

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
  const match = FENCE_LINE.exec(line)
  if (!match?.[1]) return false
  if (match[1][0] !== fence.char) return false
  if (match[1].length < fence.length) return false

  return line.slice(match[0].length).trim().length === 0
}

/**
 * Whether the text ends inside a fence that never closed. Scanned line by line
 * like the parser would: a closing fence needs the opening's character and at
 * least its length, and nothing else on the line.
 */
export function endsInsideOpenFence(text: string): boolean {
  let open: OpenFence | null = null
  for (const line of text.split('\n')) {
    if (open === null) {
      open = openingFence(line)
      continue
    }
    if (closesFence(line, open)) open = null
  }

  return open !== null
}

/** Whether a fenced code node's own source stops before its closing fence. */
export function isUnclosedFencedCode(source: string): boolean {
  const newline = source.indexOf('\n')
  const firstLine = newline === -1 ? source : source.slice(0, newline)
  const fence = openingFence(firstLine)
  if (!fence) return false
  if (newline === -1) return true

  const lastLine = source.slice(source.lastIndexOf('\n') + 1)

  return !closesFence(lastLine, fence)
}
