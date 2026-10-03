import { History, type HistoryOptions } from './history.js'
import type { EditCommand } from './keymap.js'
import { EditModel } from './model.js'
import { createLineEditorError } from './structured-errors.js'

export type ReadResult =
  | { readonly kind: 'submit'; readonly text: string }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'end' }
export interface ReadOptions {
  readonly prompt: string
  readonly secondaryPrompt?: string
  readonly signal?: AbortSignal
}
export interface SessionOptions {
  readonly history?: History | HistoryOptions
  readonly complete?: (
    line: string,
    cursor: number,
    signal: AbortSignal,
  ) => readonly string[] | Promise<readonly string[]>
  readonly isComplete?: (text: string, signal: AbortSignal) => boolean | Promise<boolean>
}
export type SessionEvent =
  | { readonly kind: 'change' | 'clear' | 'finish' }
  | { readonly kind: 'output'; readonly text: string }
  | { readonly kind: 'candidates'; readonly values: readonly string[] }

interface Reading {
  readonly options: ReadOptions
  readonly resolve: (result: ReadResult) => void
  readonly reject: (error: unknown) => void
  readonly detach: () => void
}
type State = { kind: 'idle' } | { kind: 'reading'; read: Reading } | { kind: 'disposed' }
interface Candidates {
  revision: number
  values: readonly string[]
}

function commonPrefix(values: readonly string[]): string {
  const first = values[0] ?? ''
  // A prefix must end at an editing boundary even if candidate UTF16 sequences diverge.
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(first)]
  let prefix = ''
  for (const { segment } of segments) {
    const next = prefix + segment
    if (!values.every((value) => value.startsWith(next))) break
    prefix = next
  }
  return prefix
}

export class ReadSession {
  readonly model: EditModel
  private state: State = { kind: 'idle' }
  private candidates: Candidates | undefined
  private work: AbortController | undefined
  private readonly options: SessionOptions
  private readonly emit: (event: SessionEvent) => void

  constructor(options: SessionOptions = {}, emit: (event: SessionEvent) => void = () => {}) {
    this.options = options
    this.model = new EditModel(
      options.history instanceof History ? options.history : new History(options.history),
    )
    this.emit = emit
  }

  get active(): boolean {
    return this.state.kind === 'reading'
  }

  get prompt(): { primary: string; secondary: string } | undefined {
    if (this.state.kind !== 'reading') return undefined
    const { options } = this.state.read
    return { primary: options.prompt, secondary: options.secondaryPrompt ?? '> ' }
  }

  read(options: ReadOptions): Promise<ReadResult> {
    if (this.state.kind === 'disposed')
      return Promise.reject(createLineEditorError('DISPOSED', { state: this.state.kind }))
    if (this.active)
      return Promise.reject(createLineEditorError('READ_PENDING', { state: this.state.kind }))
    if (options.signal?.aborted)
      return Promise.reject(createLineEditorError('READ_ABORTED', { aborted: true }))
    this.model.reset()
    this.cancelWork()
    return new Promise((resolve, reject) => {
      const abort = () => this.abort('READ_ABORTED')
      const detach = () => options.signal?.removeEventListener('abort', abort)
      const read: Reading = { options, resolve, reject, detach }
      this.state = { kind: 'reading', read }
      options.signal?.addEventListener('abort', abort, { once: true })
      try {
        this.emit({ kind: 'change' })
      } catch (cause) {
        detach()
        if (this.state.kind === 'reading' && this.state.read === read) {
          this.state = { kind: 'idle' }
          this.cancelWork()
        }
        reject(cause)
      }
    })
  }

  async dispatch(command: EditCommand): Promise<void> {
    if (!this.active) return
    if (command.kind === 'complete') return this.complete()
    this.cancelWork()
    if (command.kind === 'submit') return this.submit()
    if (command.kind === 'interrupt') {
      this.model.reset()
      try {
        this.emit({ kind: 'output', text: '^C\r\n' })
      } finally {
        this.finish({ kind: 'interrupt' })
      }
      return
    }
    if (command.kind === 'eof' && this.model.snapshot.text === '') {
      this.finish({ kind: 'end' })
      return
    }
    if (command.kind === 'clear') {
      this.emit({ kind: 'clear' })
      return
    }
    this.edit(command)
    this.emit({ kind: 'change' })
  }

  dispose(): void {
    if (this.state.kind === 'disposed') return
    const read = this.state.kind === 'reading' ? this.state.read : undefined
    this.state = { kind: 'disposed' }
    this.model.reset()
    this.cancelWork()
    if (!read) return
    read.detach()
    read.reject(createLineEditorError('DISPOSED', { state: 'reading' }))
    this.emit({ kind: 'finish' })
  }

  private edit(command: EditCommand): void {
    switch (command.kind) {
      case 'insert':
        this.model.insert(command.text)
        return
      case 'newline':
        this.model.insert('\n')
        return
      case 'left':
      case 'right':
      case 'start':
      case 'end':
      case 'word-left':
      case 'word-right':
        this.model.move(command.kind)
        return
      case 'backspace':
        this.model.delete('backward')
        return
      case 'delete':
      case 'eof':
        this.model.delete('forward')
        return
      case 'kill-word':
        this.model.kill('word')
        return
      case 'kill-start':
        this.model.kill('start')
        return
      case 'kill-end':
        this.model.kill('end')
        return
      case 'yank':
        this.model.yank()
        return
      case 'previous':
      case 'next':
        this.model.recall(command.kind)
        return
      case 'search':
        this.model.search()
        return
      case 'cancel-search':
        this.model.cancelSearch()
        return
      default:
        return
    }
  }

  private async complete(): Promise<void> {
    const complete = this.options.complete
    if (!complete || this.state.kind !== 'reading') return
    this.model.acceptSearch()
    const snapshot = this.model.snapshot
    if (this.candidates?.revision === snapshot.revision) {
      this.emit({ kind: 'candidates', values: this.candidates.values })
      return
    }
    this.cancelWork()
    const work = new AbortController()
    this.work = work
    const read = this.state.read
    let values: readonly string[]
    try {
      values = await complete(snapshot.text, snapshot.cursor, work.signal)
    } catch (cause) {
      if (!this.current(read, snapshot.revision, work)) return
      this.work = undefined
      throw cause
    }
    if (!this.current(read, snapshot.revision, work)) return
    this.work = undefined
    const candidates = [...new Set(values)]
    if (candidates.length === 0) return
    const prefix = commonPrefix(candidates)
    const before = snapshot.text.slice(0, snapshot.cursor)
    const from = before.search(/[^\s]*$/u)
    const typed = before.slice(from)
    const replace =
      candidates.length === 1 || (prefix.length > typed.length && prefix.startsWith(typed))
    if (replace) this.model.replace(from, snapshot.cursor, prefix)
    if (candidates.length > 1)
      this.candidates = {
        revision: this.model.snapshot.revision,
        values: Object.freeze(candidates),
      }
    if (replace) this.emit({ kind: 'change' })
  }

  private async submit(): Promise<void> {
    if (this.state.kind !== 'reading') return
    this.model.acceptSearch()
    const read = this.state.read
    const snapshot = this.model.snapshot
    const work = new AbortController()
    this.work = work
    let complete: boolean
    try {
      complete = await (this.options.isComplete?.(snapshot.text, work.signal) ?? true)
    } catch (cause) {
      if (!this.current(read, snapshot.revision, work)) return
      this.work = undefined
      throw cause
    }
    if (!this.current(read, snapshot.revision, work)) return
    this.work = undefined
    if (!complete) {
      this.model.replace(snapshot.text.length, snapshot.text.length, '\n')
      this.emit({ kind: 'change' })
      return
    }
    this.model.history.add(snapshot.text)
    this.finish({ kind: 'submit', text: snapshot.text })
  }

  private current(read: Reading, revision: number, work: AbortController): boolean {
    return (
      this.state.kind === 'reading' &&
      this.state.read === read &&
      !work.signal.aborted &&
      this.work === work &&
      this.model.snapshot.revision === revision
    )
  }

  private finish(result: ReadResult): void {
    if (this.state.kind !== 'reading') return
    const read = this.state.read
    this.state = { kind: 'idle' }
    this.cancelWork()
    read.detach()
    read.resolve(result)
    this.emit({ kind: 'finish' })
  }

  private abort(code: 'READ_ABORTED' | 'DISPOSED'): void {
    if (this.state.kind !== 'reading') return
    const read = this.state.read
    this.state = { kind: 'idle' }
    this.model.reset()
    this.cancelWork()
    read.detach()
    read.reject(createLineEditorError(code, { state: 'reading' }))
    this.emit({ kind: 'finish' })
  }

  private cancelWork(): void {
    this.work?.abort()
    this.work = undefined
    this.candidates = undefined
  }
}
