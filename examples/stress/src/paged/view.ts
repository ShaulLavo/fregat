import type { PagedDocument, PagedDocumentView, PagedWindow } from '@singapore-editor/paged'

/** This viewport renders a range; it never advertises itself as a complete Editor document. */
export class PagedViewport {
  readonly #view: PagedDocumentView
  readonly #status = document.createElement('p')
  readonly #rows = document.createElement('div')
  readonly #jump = document.createElement('input')
  readonly #copied = document.createElement('output')
  #line = 0
  #generation = 0
  #window: PagedWindow | null = null

  constructor(
    private readonly host: HTMLElement,
    private readonly source: PagedDocument,
  ) {
    this.#view = source.createView()
    this.#jump.type = 'number'
    this.#jump.min = '1'
    this.#jump.value = '1'
    this.#jump.setAttribute('aria-label', 'Global line number')
    this.#status.setAttribute('role', 'status')
    this.#rows.setAttribute('aria-label', 'Read-only file range')
    this.#rows.tabIndex = 0
    this.#rows.style.cssText =
      'height:480px;overflow:hidden;font:14px/20px monospace;white-space:pre'
    this.#copied.setAttribute('aria-label', 'Copied text')
    const controls = document.createElement('div')
    controls.append(
      this.button('Previous page', () => this.show(this.#line - 24)),
      this.button('Next page', () => this.show(this.#line + 24)),
      this.#jump,
      this.button('Go to line', () => this.show(Number(this.#jump.value) - 1)),
      this.button('Copy first visible line', () => this.copyFirstLine()),
    )
    this.#rows.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        void this.show(this.#line + Math.sign(event.deltaY) * 3)
      },
      { passive: false },
    )
    this.#rows.addEventListener('keydown', (event) => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      event.preventDefault()
      void this.show(this.#line + (event.key === 'PageDown' ? 24 : -24))
    })
    host.append(controls, this.#status, this.#rows, this.#copied)
  }

  async show(line: number) {
    const generation = ++this.#generation
    this.#line = Math.max(
      0,
      Math.min(line, this.source.stats.state === 'ready' ? this.source.stats.lines - 1 : line),
    )
    this.#status.textContent = `Loading line ${this.#line + 1}…`
    this.host.setAttribute('aria-busy', 'true')
    try {
      const window = await this.#view.readLines(this.#line, 24)
      if (generation !== this.#generation) return
      this.#window = window
      this.#jump.value = String(this.#line + 1)
      this.#rows.replaceChildren(...window.rows.map(rowElement))
      this.#status.textContent = window.truncated
        ? 'This line exceeds the visible text limit. Range copy is available.'
        : `Read-only UTF-8 · Lines ${this.#line + 1}–${this.#line + window.rows.length}`
    } catch (error) {
      if (generation !== this.#generation) return
      this.#rows.replaceChildren()
      this.#status.textContent =
        error instanceof Error ? error.message : 'The range could not load.'
    } finally {
      if (generation === this.#generation) this.host.setAttribute('aria-busy', 'false')
    }
  }

  dispose() {
    this.#generation++
    this.#view.dispose()
    this.host.replaceChildren()
  }

  private async copyFirstLine() {
    const first = this.#window?.rows[0]
    if (!first) return
    try {
      this.#copied.textContent = await this.#view.copyRange(
        first.offset,
        first.offset + first.text.length,
      )
    } catch (error) {
      this.#status.textContent =
        error instanceof Error ? error.message : 'The range could not copy.'
    }
  }

  private button(label: string, action: () => Promise<void>) {
    const button = document.createElement('button')
    button.textContent = label
    button.addEventListener('click', () => {
      void action()
    })
    return button
  }
}

function rowElement(row: {
  readonly line: number
  readonly offset: number
  readonly text: string
}) {
  const element = document.createElement('div')
  element.dataset.line = String(row.line + 1)
  element.dataset.offset = String(row.offset)
  const number = document.createElement('span')
  number.textContent = `${row.line + 1}  `
  number.style.cssText = 'display:inline-block;min-width:100px;color:#777'
  const text = document.createElement('span')
  text.dataset.text = ''
  text.textContent = row.text.endsWith('\r') ? row.text.slice(0, -1) : row.text
  element.append(number, text)
  return element
}
