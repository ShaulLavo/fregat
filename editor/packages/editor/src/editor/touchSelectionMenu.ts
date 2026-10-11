export type TouchMenuItem = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly failureMessage?: string
  run(): void | Promise<void>
}

/** A framework-neutral touch popover; host tokens supply the same surface as app menus. */
export class TouchSelectionMenu {
  private element: HTMLDivElement | null = null
  private pending = false

  constructor(
    private readonly editor: HTMLElement,
    private readonly items: () => readonly TouchMenuItem[],
  ) {}

  show(x: number, y: number, bottom = y + 16): void {
    this.hide()
    const document = this.editor.ownerDocument
    const element = document.createElement('div')
    element.className = 'editor-touch-menu'
    element.setAttribute('role', 'toolbar')
    element.setAttribute('aria-label', 'Selection actions')
    const style = document.defaultView?.getComputedStyle(this.editor)
    for (const name of [
      '--popover-solid',
      '--popover',
      '--popover-foreground',
      '--foreground',
      '--row-hover',
      '--editor-z-overlay-popup',
    ]) {
      const value = style?.getPropertyValue(name)
      if (value) element.style.setProperty(name, value)
    }
    const actions = document.createElement('div')
    actions.className = 'editor-touch-menu-actions'
    element.append(actions)
    for (const item of this.items()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = item.label
      button.dataset.action = item.id
      button.disabled = item.disabled ?? false
      button.addEventListener('click', () => this.run(item, element))
      actions.append(button)
    }
    element.addEventListener('mousedown', (event) => event.preventDefault())
    element.addEventListener('keydown', this.keyDown)
    document.body.append(element)
    this.element = element
    const viewport = document.defaultView?.visualViewport
    const width = viewport?.width ?? document.documentElement.clientWidth
    const left = viewport?.offsetLeft ?? 0
    const top = viewport?.offsetTop ?? 0
    const height = viewport?.height ?? document.documentElement.clientHeight
    element.style.maxWidth = `${Math.max(0, width - 16)}px`
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(left + 8, Math.min(left + width - bounds.width - 8, x - bounds.width / 2))}px`
    const above = y - bounds.height - 16 >= top + 8
    element.dataset.side = above ? 'top' : 'bottom'
    element.style.top = `${Math.max(top + 8, Math.min(top + height - bounds.height - 8, above ? y - bounds.height - 16 : bottom + 16))}px`
    element.style.setProperty(
      '--editor-touch-arrow-x',
      `${Math.max(16, Math.min(bounds.width - 16, x - Number.parseFloat(element.style.left)))}px`,
    )
    document.addEventListener('pointerdown', this.outside, { capture: true })
  }

  hide(): void {
    this.editor.ownerDocument.removeEventListener('pointerdown', this.outside, { capture: true })
    this.element?.remove()
    this.element = null
  }

  dispose(): void {
    this.hide()
  }

  private outside = (event: PointerEvent): void => {
    const node = this.editor.ownerDocument.defaultView?.Node
    if (node && event.target instanceof node && this.element?.contains(event.target)) return
    this.hide()
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.hide()
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const buttons = Array.from(
      this.element?.querySelectorAll<HTMLButtonElement>('button:enabled') ?? [],
    )
    const current = buttons.findIndex(
      (button) => button === this.editor.ownerDocument.activeElement,
    )
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    buttons[(current + direction + buttons.length) % buttons.length]?.focus()
    event.preventDefault()
  }

  private run(item: TouchMenuItem, element: HTMLDivElement): void {
    if (this.pending) return
    this.pending = true
    element.setAttribute('aria-busy', 'true')
    // Invoke in the click's activation turn so Safari can authorize clipboard access.
    let result: void | Promise<void>
    try {
      result = item.run()
    } catch {
      this.failed(element, item.failureMessage)
      return
    }
    void Promise.resolve(result).then(
      () => {
        this.pending = false
        if (this.element === element) this.hide()
      },
      () => this.failed(element, item.failureMessage),
    )
  }

  private failed(element: HTMLDivElement, message?: string): void {
    this.pending = false
    element.removeAttribute('aria-busy')
    if (this.element !== element) return
    let status = element.querySelector('[role="status"]')
    if (!status) {
      status = this.editor.ownerDocument.createElement('span')
      status.setAttribute('role', 'status')
      element.append(status)
    }
    status.textContent = message ?? 'The action could not finish. Try again.'
  }
}
