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
  output: v.string(),
  invalid: v.boolean(),
  oversized: v.boolean(),
  complete: v.boolean(),
})
export type TranscriptJsonState = v.InferOutput<typeof transcriptJsonStateSchema>

type Fields = { readonly [key: string]: true | Fields }
const fields: Fields = {
  type: true,
  timestamp: true,
  uuid: true,
  sessionId: true,
  requestId: true,
  costUSD: true,
  message: {
    id: true,
    model: true,
    usage: {
      input_tokens: true,
      output_tokens: true,
      cache_read_input_tokens: true,
      cache_creation_input_tokens: true,
      output_tokens_details: { thinking_tokens: true },
    },
  },
  payload: {
    type: true,
    id: true,
    session_id: true,
    turn_id: true,
    model: true,
    forked_from_id: true,
    source: { subagent: { thread_spawn: { parent_thread_id: true } } },
    info: {
      total_token_usage: {
        input_tokens: true,
        cached_input_tokens: true,
        cache_write_input_tokens: true,
        output_tokens: true,
        reasoning_output_tokens: true,
      },
      last_token_usage: {
        input_tokens: true,
        cached_input_tokens: true,
        cache_write_input_tokens: true,
        output_tokens: true,
        reasoning_output_tokens: true,
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
    output: '',
    invalid: false,
    oversized: false,
    complete: false,
  }
}

function selectedPath(path: readonly string[]) {
  let current: true | Fields = fields
  for (const key of path) {
    if (current === true) return true
    const next: true | Fields | undefined = current[key]
    if (next === undefined) return false
    current = next
  }
  return true
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
        !this.state.unicodeRemaining
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
        this.state.token += char
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
      const selection = this.startValue()
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
    this.state.capture = this.state.isKey ? (frame?.selected ?? false) : this.startValue().selected
    this.state.token = ''
    this.state.mode = 'string'
    this.state.escaped = false
    this.state.unicodeRemaining = 0
  }

  private string(char: string) {
    if (this.state.unicodeRemaining) {
      if (!/[0-9a-f]/iu.test(char)) this.state.invalid = true
      if (this.state.capture) this.state.token += char
      this.state.unicodeRemaining--
      return
    }
    if (this.state.escaped) {
      if (char === 'u') this.state.unicodeRemaining = 4
      else if (!'"\\/bfnrt'.includes(char)) this.state.invalid = true
      if (this.state.capture) this.state.token += char
      this.state.escaped = false
      return
    }
    if (char === '\\') {
      if (this.state.capture) this.state.token += char
      this.state.escaped = true
      return
    }
    if (char !== '"') {
      if (char.charCodeAt(0) < 32) this.state.invalid = true
      if (this.state.capture) this.state.token += char
      return
    }
    this.state.mode = 'idle'
    if (!this.state.isKey) {
      if (this.state.capture) this.emit('"' + this.state.token + '"')
      this.endValue()
      this.state.token = ''
      return
    }
    const frame = this.state.frames.at(-1)
    if (!frame) {
      this.state.invalid = true
      return
    }
    try {
      frame.key = this.state.capture ? JSON.parse('"' + this.state.token + '"') : ''
    } catch {
      this.state.invalid = true
    }
    frame.stage = 'colon'
    this.state.token = ''
  }

  private startValue() {
    const frame = this.state.frames.at(-1)
    if (!frame) {
      if (this.state.complete) this.state.invalid = true
      return { selected: true, path: [] }
    }
    if (frame.stage !== 'value') this.state.invalid = true
    const path = [...frame.path, frame.key]
    const selected = frame.selected && frame.kind === 'object' && selectedPath(path)
    if (selected) {
      if (frame.entries) this.emit(',')
      this.emit(JSON.stringify(frame.key) + ':')
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
    this.state.capture = this.startValue().selected
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
