export type StackFrame = {
  column: number | null
  end: number
  /** Dependency or runtime code: shown muted, never opened. */
  external: boolean
  line: number
  path: string
  start: number
}

export type StackFrameSegment = { frame: StackFrame | null; text: string }

const SOURCE_EXTENSIONS =
  'c|cc|cjs|cpp|cs|css|cts|go|h|hpp|java|js|json|jsx|kt|mjs|mts|php|py|rb|rs|scss|svelte|swift|ts|tsx|vue|zig'
// A frame starts a word: `host:5173/app.js:12` is a URL, not a path.
const WORD_START = `(?<![^\\s(\\['"\`=])`
const PATH = `((?:[A-Za-z]:)?[^\\s()'"\`:,|]*\\.(?:${SOURCE_EXTENSIONS}))`
// Bun, Node, Vitest and tsc --pretty: `path:line[:col]`, maybe behind file://.
const COLON_FRAME = new RegExp(`${WORD_START}(?:file://)?${PATH}:(\\d+)(?::(\\d+))?(?![\\w.])`, 'g')
// tsc: `path(line,col)`.
const PAREN_FRAME = new RegExp(`${WORD_START}${PATH}\\((\\d+),(\\d+)\\)`, 'g')
// Python: `File "path", line N`.
const PYTHON_FRAME = /File "([^"]+)", line (\d+)/g
// Node and Bun internals carry no extension.
const RUNTIME_FRAME = /\b(?:node|bun):[\w/.-]+:(\d+)(?::(\d+))?/g

/** Every `path:line` frame in one line of tool output, in order, without overlaps. */
export function stackFrames(line: string): StackFrame[] {
  const frames = [
    ...pathFrames(line, COLON_FRAME),
    ...pathFrames(line, PAREN_FRAME),
    ...pythonFrames(line),
    ...runtimeFrames(line),
  ].toSorted((left, right) => left.start - right.start)

  const kept: StackFrame[] = []
  for (const frame of frames) {
    const previous = kept.at(-1)
    if (previous && frame.start < previous.end) continue

    kept.push(frame)
  }

  return kept
}

/** The line cut into plain text and frames, so a renderer walks it once. */
export function stackFrameSegments(line: string): StackFrameSegment[] {
  const segments: StackFrameSegment[] = []
  let cursor = 0
  for (const frame of stackFrames(line)) {
    if (frame.start > cursor) segments.push({ frame: null, text: line.slice(cursor, frame.start) })
    segments.push({ frame, text: line.slice(frame.start, frame.end) })
    cursor = frame.end
  }
  if (cursor < line.length) segments.push({ frame: null, text: line.slice(cursor) })

  return segments
}

function pathFrames(line: string, pattern: RegExp): StackFrame[] {
  const frames: StackFrame[] = []
  for (const match of line.matchAll(pattern)) {
    const path = match[1] ?? ''
    frames.push({
      column: match[3] ? Number(match[3]) : null,
      end: match.index + match[0].length,
      external: isExternalPath(path),
      line: Number(match[2]),
      path,
      start: match.index,
    })
  }

  return frames
}

function pythonFrames(line: string): StackFrame[] {
  return [...line.matchAll(PYTHON_FRAME)].map((match) => {
    const path = match[1] ?? ''
    const start = match.index + match[0].indexOf('"') + 1

    return {
      column: null,
      end: start + path.length,
      external: isExternalPath(path) || path.startsWith('<'),
      line: Number(match[2]),
      path,
      start,
    }
  })
}

function runtimeFrames(line: string): StackFrame[] {
  return [...line.matchAll(RUNTIME_FRAME)].map((match) => ({
    column: match[2] ? Number(match[2]) : null,
    end: match.index + match[0].length,
    external: true,
    line: Number(match[1]),
    path: match[0],
    start: match.index,
  }))
}

function isExternalPath(path: string) {
  return /(?:^|[\\/])(?:node_modules|site-packages)[\\/]/.test(path)
}
