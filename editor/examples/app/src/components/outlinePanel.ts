import type { Editor } from '@singapore-editor/core/editor'
import { pathOrUriToDocumentUri } from '@singapore-editor/typescript-lsp'
import { el } from './dom.ts'

const REFRESH_DELAY_MS = 250

/** The part of the language client the outline asks through. */
export type OutlineClient = {
  readonly initialized: boolean
  /** Settles when `initialize` has been answered; null before the client connects. */
  readonly initialization: Promise<void> | null
  request<T>(method: string, params: unknown): Promise<T>
}

type OutlineSymbol = {
  readonly name: string
  readonly kind: number
  readonly selectionRange: { readonly start: { readonly line: number; readonly character: number } }
  readonly children?: readonly OutlineSymbol[]
}

const KIND_LABELS = new Map([
  [2, 'module'],
  [5, 'class'],
  [6, 'method'],
  [7, 'property'],
  [9, 'constructor'],
  [10, 'enum'],
  [11, 'interface'],
  [12, 'function'],
  [13, 'variable'],
  [22, 'member'],
  [26, 'type'],
])

export type OutlinePanel = {
  readonly element: HTMLDivElement
  setOpen(open: boolean): void
  setClient(client: OutlineClient | null): void
  /** Asks again, after a short pause so a burst of edits asks once. */
  refresh(): void
}

export function createOutlinePanel(editor: Editor): OutlinePanel {
  return new OutlinePanelController(editor)
}

/** The active file's symbols from the TypeScript worker, each one a jump to its name. */
class OutlinePanelController implements OutlinePanel {
  readonly element = el('div', { id: 'outline', hidden: '' })
  private readonly list = el('div', { id: 'outline-list', role: 'tree', 'aria-label': 'Outline' })
  private readonly status = el('div', { id: 'outline-status' })
  private client: OutlineClient | null = null
  private open = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  /** What the shown symbols describe; a caret move or a scroll changes neither. */
  private shown: { readonly documentId: string; readonly text: unknown } | null = null

  constructor(private readonly editor: Editor) {
    const header = el('div', { id: 'outline-header' })
    header.textContent = 'Outline'
    this.element.append(header, this.list, this.status)
  }

  setOpen(open: boolean): void {
    this.open = open
    this.element.hidden = !open
    this.refresh()
  }

  setClient(client: OutlineClient | null): void {
    this.client = client
    this.shown = null
    this.refresh()
  }

  refresh(): void {
    if (!this.open) return
    if (this.isShowingCurrentText()) return
    if (this.timer) clearTimeout(this.timer)
    // @justification Debounces outline requests in the demo app; the handle is cleared before each
    // reschedule, and a stale load is dropped by its generation.
    this.timer = setTimeout(() => {
      this.timer = null
      void this.load()
    }, REFRESH_DELAY_MS)
  }

  private isShowingCurrentText(): boolean {
    const shown = this.shown
    if (!shown) return false
    return (
      shown.documentId === this.editor.getState().documentId &&
      shown.text === this.editor.getTextSnapshot()
    )
  }

  /** A client still initializing is waited for; a missing one is refreshed by `setClient`. */
  private async load(): Promise<void> {
    const generation = ++this.generation
    const documentId = this.editor.getState().documentId
    const text = this.editor.getTextSnapshot()
    const client = this.client
    if (!documentId || !client) {
      this.show([], 'Waiting for the TypeScript worker')
      return
    }

    try {
      if (!client.initialized) await client.initialization
      const symbols = await client.request<OutlineSymbol[] | null>('textDocument/documentSymbol', {
        textDocument: { uri: pathOrUriToDocumentUri(documentId) },
      })
      if (generation !== this.generation) return
      this.shown = { documentId, text }
      this.show(symbols ?? [], symbols?.length ? '' : 'No symbols in this file')
    } catch {
      if (generation === this.generation) this.show([], 'No outline for this file')
    }
  }

  private show(symbols: readonly OutlineSymbol[], status: string): void {
    this.list.replaceChildren(...symbols.flatMap((symbol) => this.rows(symbol, 0)))
    this.status.textContent = status
  }

  private rows(symbol: OutlineSymbol, depth: number): HTMLElement[] {
    const row = el('div', { role: 'treeitem', 'aria-level': String(depth + 1) })
    row.style.paddingLeft = `${10 + depth * 14}px`
    const kind = el('span', { class: 'outline-kind' })
    kind.textContent = KIND_LABELS.get(symbol.kind) ?? 'symbol'
    const name = el('span', { class: 'outline-name' })
    name.textContent = symbol.name
    row.append(kind, name)
    row.onclick = () => this.reveal(symbol)
    return [row, ...(symbol.children ?? []).flatMap((child) => this.rows(child, depth + 1))]
  }

  private reveal(symbol: OutlineSymbol): void {
    const snapshot = this.editor.getTextSnapshot()
    const { line, character } = symbol.selectionRange.start
    if (line >= snapshot.lineCount) return

    const offset = Math.min(snapshot.lineRange(line).start + character, snapshot.length)
    this.editor.setSelection(offset, offset, { revealOffset: offset })
    this.editor.focus()
  }
}
