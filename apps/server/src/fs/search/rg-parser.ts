export function parseRgMatchLine(line: string): RgMatchEvent | null {
  const event = parseRgLine(line)
  if (!event) return null
  if (!isRgMatchEvent(event)) return null

  return event
}

function parseRgLine(line: string): RgEvent | null {
  try {
    return JSON.parse(line) as RgEvent
  } catch {
    return null
  }
}

function isRgMatchEvent(event: RgEvent): event is RgMatchEvent {
  if (event.type !== 'match') return false
  if (!event.data || typeof event.data !== 'object') return false

  return 'path' in event.data && 'lines' in event.data
}

type RgEvent =
  | RgMatchEvent
  | {
      type: string
      data?: unknown
    }

export type RgMatchEvent = {
  type: 'match'
  data: {
    path: {
      text: string
    }
    lines: { text: string } | { bytes: string }
    line_number: number
    submatches: Array<{
      end: number
      start: number
    }>
  }
}
