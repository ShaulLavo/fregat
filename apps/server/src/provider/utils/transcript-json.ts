import * as v from 'valibot'

const frameSchema = v.object({
  kind: v.picklist(['object', 'array']),
  selected: v.boolean(),
  path: v.array(v.string()),
  key: v.string(),
  stage: v.picklist(['key', 'colon', 'value', 'comma']),
  entries: v.number(),
  endAllowed: v.boolean(),
})

export const transcriptJsonStateSchema = v.object({
  frames: v.array(frameSchema),
  mode: v.picklist(['idle', 'string', 'scalar']),
  token: v.string(),
  capture: v.boolean(),
  isKey: v.boolean(),
  escaped: v.boolean(),
  unicodeRemaining: v.number(),
  unicodeValue: v.number(),
  redacted: v.boolean(),
  nonWhitespace: v.boolean(),
  interruptionMatch: v.number(),
  output: v.string(),
  invalid: v.boolean(),
  oversized: v.boolean(),
  complete: v.boolean(),
})
export type TranscriptJsonState = v.InferOutput<typeof transcriptJsonStateSchema>

type Field = 'string' | 'number' | 'boolean' | Fields
type Fields = { readonly [key: string]: Field }
type ValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
const interruption = '[Request interrupted by user'
const fields: Fields = {
  type: 'string',
  timestamp: 'string',
  uuid: 'string',
  sessionId: 'string',
  requestId: 'string',
  costUSD: 'number',
  isMeta: 'boolean',
  isCompactSummary: 'boolean',
  message: {
    id: 'string',
    model: 'string',
    content: { type: 'string', text: 'string' },
    usage: {
      input_tokens: 'number',
      output_tokens: 'number',
      cache_read_input_tokens: 'number',
      cache_creation_input_tokens: 'number',
      output_tokens_details: { thinking_tokens: 'number' },
    },
  },
  payload: {
    type: 'string',
    id: 'string',
    session_id: 'string',
    turn_id: 'string',
    model: 'string',
    forked_from_id: 'string',
    source: { subagent: { thread_spawn: { parent_thread_id: 'string' } } },
    info: {
      total_token_usage: {
        input_tokens: 'number',
        cached_input_tokens: 'number',
        cache_write_input_tokens: 'number',
        output_tokens: 'number',
        reasoning_output_tokens: 'number',
      },
      last_token_usage: {
        input_tokens: 'number',
        cached_input_tokens: 'number',
        cache_write_input_tokens: 'number',
        output_tokens: 'number',
        reasoning_output_tokens: 'number',
      },
    },
  },
}

export function initialTranscriptJsonState(): TranscriptJsonState {
  return {
    frames: [],
    mode: 'idle',
    token: '',
    capture: false,
    isKey: false,
    escaped: false,
    unicodeRemaining: 0,
    unicodeValue: 0,
    redacted: false,
    nonWhitespace: false,
    interruptionMatch: 0,
    output: '',
    invalid: false,
    oversized: false,
    complete: false,
  }
}

function fieldAt(path: readonly string[]): Field | undefined {
  let current: Field | undefined = fields
  for (const key of path) {
    if (!current || typeof current === 'string') return undefined
    current = current[key]
  }
  return current
}

function isContentText(path: readonly string[]) {
  return (
    path[0] === 'message' &&
    path[1] === 'content' &&
    (path.length === 2 || (path.length === 3 && path[2] === 'text'))
  )
}

function selectedPath(path: readonly string[], kind: ValueKind) {
  const field = fieldAt(path)
  if (!field) return false
  if (kind === 'string' && isContentText(path)) return true
  if (kind === 'object') return typeof field === 'object'
  if (kind === 'array') return path.length === 2 && path[0] === 'message' && path[1] === 'content'
  return field === kind || (kind === 'null' && typeof field === 'string')
}

function decodedEscape(char: string) {
  if (char === 'b') return '\b'
  if (char === 'f') return '\f'
  if (char === 'n') return '\n'
  if (char === 'r') return '\r'
  if (char === 't') return '\t'
  return char
}

/** Incremental JSON projection discards conversation strings before allocating or persisting them. */
export class TranscriptJsonProjector {
  readonly state: TranscriptJsonState
  private readonly maxBytes: number

  constructor(state: TranscriptJsonState, maxBytes: number) {
    this.state = state
    this.maxBytes = maxBytes
  }

  write(text: string) {
    let index = 0
    while (index < text.length && !this.state.invalid && !this.state.oversized) {
      if (
        this.state.mode === 'string' &&
        !this.state.capture &&
        !this.state.escaped &&
        !this.state.unicodeRemaining &&
        (!this.state.redacted ||
          (this.state.nonWhitespace &&
            (this.state.interruptionMatch < 0 ||
              this.state.interruptionMatch >= interruption.length)))
      ) {
        const quote = text.indexOf('"', index)
        const slash = text.indexOf('\\', index)
        const stop = Math.min(quote < 0 ? text.length : quote, slash < 0 ? text.length : slash)
        // Unselected strings still obey JSON's control-character constraint.
        if (hasControlCharacter(text, index, stop)) this.state.invalid = true
        index = stop
        if (index === text.length) break
      }
      this.character(text[index] ?? '')
      index++
      if (this.state.output.length + this.state.token.length > this.maxBytes)
        this.state.oversized = true
    }
  }

  finish(): unknown {
    if (this.state.mode === 'scalar') this.scalar()
    if (
      this.state.invalid ||
      this.state.oversized ||
      !this.state.complete ||
      this.state.frames.length
    )
      return undefined
    try {
      return JSON.parse(this.state.output)
    } catch {
      return undefined
    }
  }

  private character(char: string) {
    if (this.state.mode === 'string') {
      this.string(char)
      return
    }
    if (this.state.mode === 'scalar') {
      if (!/[ \t\r\n,}\]]/u.test(char)) {
        const next = this.state.token + char
        const numeric = /^[0-9-]/u.test(this.state.token)
        const valid = numeric
          ? /^[0-9eE+.-]$/u.test(char)
          : ['true', 'false', 'null'].some((word) => word.startsWith(next))
        if (!valid) {
          this.state.invalid = true
          this.state.token = ''
          return
        }
        this.state.token = next
        return
      }
      this.scalar()
    }
    if (/[ \t\r\n]/u.test(char)) return
    const frame = this.state.frames.at(-1)
    if (char === '"') {
      this.startString()
      return
    }
    if (char === '{' || char === '[') {
      const selection = this.startValue(char === '{' ? 'object' : 'array')
      this.state.frames.push({
        kind: char === '{' ? 'object' : 'array',
        ...selection,
        key: '',
        stage: char === '{' ? 'key' : 'value',
        entries: 0,
        endAllowed: true,
      })
      if (selection.selected) this.emit(char)
      if (this.state.frames.length > 128) this.state.invalid = true
      return
    }
    if (char === '}' || char === ']') {
      this.endContainer(char)
      return
    }
    if (char === ':') {
      if (frame?.stage !== 'colon') {
        this.state.invalid = true
        return
      }
      frame.stage = 'value'
      return
    }
    if (char === ',') {
      if (frame?.stage !== 'comma') {
        this.state.invalid = true
        return
      }
      frame.stage = frame.kind === 'object' ? 'key' : 'value'
      frame.endAllowed = false
      return
    }
    this.startScalar(char)
  }

  private startString() {
    const frame = this.state.frames.at(-1)
    this.state.isKey = frame?.kind === 'object' && frame.stage === 'key'
    const selection = this.state.isKey ? null : this.startValue('string')
    this.state.redacted = Boolean(selection?.selected && isContentText(selection.path))
    this.state.capture = this.state.isKey
      ? (frame?.selected ?? false)
      : Boolean(selection?.selected && !this.state.redacted)
    this.state.token = ''
    this.state.mode = 'string'
    this.state.escaped = false
    this.state.unicodeRemaining = 0
    this.state.unicodeValue = 0
    this.state.nonWhitespace = false
    this.state.interruptionMatch = 0
  }

  private string(char: string) {
    if (this.state.unicodeRemaining) {
      if (!/[0-9a-f]/iu.test(char)) this.state.invalid = true
      this.state.unicodeValue = this.state.unicodeValue * 16 + (Number.parseInt(char, 16) || 0)
      if (this.state.capture && !this.state.isKey) this.state.token += char
      this.state.unicodeRemaining--
      if (!this.state.unicodeRemaining)
        this.observeCharacter(String.fromCharCode(this.state.unicodeValue))
      return
    }
    if (this.state.escaped) {
      if (char === 'u') {
        this.state.unicodeRemaining = 4
        this.state.unicodeValue = 0
      } else if (!'"\\/bfnrt'.includes(char)) this.state.invalid = true
      else this.observeCharacter(decodedEscape(char))
      if (this.state.capture && !this.state.isKey) this.state.token += char
      this.state.escaped = false
      return
    }
    if (char === '\\') {
      if (this.state.capture && !this.state.isKey) this.state.token += char
      this.state.escaped = true
      return
    }
    if (char !== '"') {
      if (char.charCodeAt(0) < 32) this.state.invalid = true
      this.observeCharacter(char)
      if (this.state.capture && !this.state.isKey) this.state.token += char
      return
    }
    this.finishString()
  }

  private observeCharacter(char: string) {
    if (this.state.isKey && this.state.capture) {
      this.state.token += char
      const field = fieldAt(this.state.frames.at(-1)?.path ?? [])
      const recognized =
        typeof field === 'object' &&
        Object.keys(field).some((key) => key.startsWith(this.state.token))
      if (!recognized) {
        this.state.capture = false
        this.state.token = ''
      }
    }
    if (!this.state.redacted) return
    if (char.trim()) this.state.nonWhitespace = true
    if (this.state.interruptionMatch < 0 || this.state.interruptionMatch >= interruption.length)
      return
    this.state.interruptionMatch =
      interruption[this.state.interruptionMatch] === char ? this.state.interruptionMatch + 1 : -1
  }

  private finishString() {
    this.state.mode = 'idle'
    if (!this.state.isKey) {
      if (this.state.capture) this.emit('"' + this.state.token + '"')
      if (this.state.redacted) {
        let marker = this.state.nonWhitespace ? 'x' : ''
        if (this.state.interruptionMatch >= interruption.length) marker = interruption
        this.emit(JSON.stringify(marker))
      }
      this.endValue()
      this.state.token = ''
      this.state.redacted = false
      return
    }
    const frame = this.state.frames.at(-1)
    if (!frame) {
      this.state.invalid = true
      return
    }
    frame.key = this.state.capture ? this.state.token : ''
    frame.stage = 'colon'
    this.state.token = ''
  }

  private startValue(kind: ValueKind) {
    const frame = this.state.frames.at(-1)
    if (!frame) {
      if (this.state.complete) this.state.invalid = true
      return { selected: kind === 'object', path: [] }
    }
    if (frame.stage !== 'value') this.state.invalid = true
    const path = frame.kind === 'array' ? frame.path : [...frame.path, frame.key]
    const selected = frame.selected && selectedPath(path, kind)
    if (selected) {
      if (frame.entries) this.emit(',')
      if (frame.kind === 'object') this.emit(JSON.stringify(frame.key) + ':')
      frame.entries++
    }
    return { selected, path: selected ? path : [] }
  }

  private endValue() {
    const parent = this.state.frames.at(-1)
    if (parent) {
      parent.stage = 'comma'
      parent.endAllowed = true
      return
    }
    this.state.complete = true
  }

  private endContainer(char: string) {
    const frame = this.state.frames.pop()
    if (!frame || (char === '}') !== (frame.kind === 'object')) {
      this.state.invalid = true
      return
    }
    if (
      !frame.endAllowed ||
      frame.stage === 'colon' ||
      (frame.kind === 'object' && frame.stage === 'value')
    )
      this.state.invalid = true
    if (frame.selected) this.emit(char)
    this.endValue()
  }

  private startScalar(char: string) {
    if (!/[-0-9tfn]/u.test(char)) {
      this.state.invalid = true
      return
    }
    let kind: ValueKind = 'number'
    if (char === 't' || char === 'f') kind = 'boolean'
    if (char === 'n') kind = 'null'
    this.state.capture = this.startValue(kind).selected
    this.state.mode = 'scalar'
    this.state.token = char
  }

  private scalar() {
    try {
      const value: unknown = JSON.parse(this.state.token)
      if (value !== null && typeof value !== 'number' && typeof value !== 'boolean')
        this.state.invalid = true
    } catch {
      this.state.invalid = true
    }
    if (this.state.capture) this.emit(this.state.token)
    this.state.token = ''
    this.state.mode = 'idle'
    this.endValue()
  }

  private emit(text: string) {
    this.state.output += text
  }
}

function hasControlCharacter(text: string, start: number, end: number) {
  for (let index = start; index < end; index++) {
    if (text.charCodeAt(index) < 32) return true
  }
  return false
}
