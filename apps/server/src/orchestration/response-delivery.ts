export type ResponseStreamingMode = 'paragraph' | 'turn' | 'token'
export const MIN_ASSISTANT_DELIVERY_INTERVAL_MS = 400

const MARKDOWN_FENCE_PATTERN = /^( *)(`{3,}|~{3,})/
const BLANK_LINE_PATTERN = /^[ \t]*$/
const LIST_ITEM_START_PATTERN = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/

export function splitBufferedAssistantText(text: string): { ready: string; rest: string } {
  let openFence: { marker: string; indent: number } | null = null
  let boundary = -1
  let lineStart = 0
  for (;;) {
    const newline = text.indexOf('\n', lineStart)
    const line = text
      .slice(lineStart, newline === -1 ? text.length : newline)
      .replace(/[ \t\r]+$/, '')
    if (openFence === null && lineStart > 0 && LIST_ITEM_START_PATTERN.test(line)) {
      boundary = lineStart
    }
    if (newline === -1) {
      break
    }
    const fenceMatch = MARKDOWN_FENCE_PATTERN.exec(line)
    if (fenceMatch) {
      const indent = fenceMatch[1]!.length
      const marker = fenceMatch[2]!
      if (openFence === null) {
        openFence = { marker, indent }
      } else if (
        marker[0] === openFence.marker[0] &&
        marker.length >= openFence.marker.length &&
        indent <= openFence.indent + 3 &&
        line.length === indent + marker.length
      ) {
        openFence = null
        boundary = newline + 1
      }
    } else if (openFence === null && BLANK_LINE_PATTERN.test(line) && lineStart > 0) {
      boundary = newline + 1
    }
    lineStart = newline + 1
  }
  if (boundary === -1) {
    return { ready: '', rest: text }
  }
  return { ready: text.slice(0, boundary), rest: text.slice(boundary) }
}
