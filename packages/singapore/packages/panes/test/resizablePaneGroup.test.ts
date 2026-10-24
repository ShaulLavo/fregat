import { describe, expect, it, vi } from 'vitest'
import { ResizablePaneGroup, type ResizablePaneLayout } from '../src'

describe('ResizablePaneGroup', () => {
  it('creates equal default layouts for two and three panes', () => {
    const two = createGroup(['left', 'right'])
    const three = createGroup(['one', 'two', 'three'])

    expect(two.group.getLayout()).toEqual({ left: 50, right: 50 })
    expect(three.group.getLayout()).toEqual({
      one: 100 / 3,
      two: 100 / 3,
      three: 100 / 3,
    })
  })

  it('clamps pointer resizing to min and max sizes', () => {
    const { container, group, handle } = createGroup(['left', 'right'], {
      minSize: { left: 30, right: 20 },
      maxSize: { left: 70, right: 80 },
    })

    dispatchPointer(handle, 'pointerdown', { clientX: 500 })
    dispatchPointer(container.ownerDocument, 'pointermove', { clientX: 950 })
    dispatchPointer(container.ownerDocument, 'pointerup', { clientX: 950 })

    expect(group.getLayout()).toEqual({ left: 70, right: 30 })
  })

  it('supports keyboard resizing and updates separator aria values', () => {
    const { group, handle } = createGroup(['left', 'right'], {
      minSize: { left: 20, right: 20 },
    })

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    expect(group.getLayout()).toEqual({ left: 55, right: 45 })
    expect(handle.getAttribute('aria-valuenow')).toBe('55')
    expect(handle.getAttribute('aria-valuemin')).toBe('20')
    expect(handle.getAttribute('aria-valuemax')).toBe('80')
  })

  it('separates live and committed layout callbacks while dragging', () => {
    const onLayoutChange = vi.fn()
    const onLayoutChanged = vi.fn()
    const { container, handle } = createGroup(['left', 'right'], {
      onLayoutChange,
      onLayoutChanged,
    })

    dispatchPointer(handle, 'pointerdown', { clientX: 500 })
    dispatchPointer(container.ownerDocument, 'pointermove', { clientX: 550 })
    dispatchPointer(container.ownerDocument, 'pointermove', { clientX: 600 })

    expect(onLayoutChange).toHaveBeenCalledTimes(2)
    expect(onLayoutChanged).not.toHaveBeenCalled()

    dispatchPointer(container.ownerDocument, 'pointerup', { clientX: 600 })

    expect(onLayoutChanged).toHaveBeenCalledTimes(1)
    expect(onLayoutChanged).toHaveBeenLastCalledWith({ left: 60, right: 40 })
  })

  it('uses custom handle elements while applying required attributes', () => {
    const createHandle = vi.fn((context) => {
      const handle = context.document.createElement('button')
      handle.className = 'custom-handle'
      handle.textContent = `${context.beforePaneId}:${context.afterPaneId}`
      return handle
    })
    const { handle } = createGroup(['left', 'right'], { createHandle })

    expect(createHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        beforePaneId: 'left',
        afterPaneId: 'right',
        index: 0,
        orientation: 'horizontal',
      }),
    )
    expect(handle.classList.contains('custom-handle')).toBe(true)
    expect(handle.classList.contains('editor-resizable-pane-handle')).toBe(true)
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.style.cursor).toBe('ew-resize')
    expect(handle.dataset.editorPaneHandleState).toBe('inactive')
  })

  it('removes document drag listeners and handles on dispose', () => {
    const { container, group, handle } = createGroup(['left', 'right'])
    const document = container.ownerDocument
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    dispatchPointer(handle, 'pointerdown', { clientX: 500 })
    group.dispose()

    expect(container.querySelector('[data-editor-pane-handle]')).toBeNull()
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function), true)
  })
})

type CreateGroupOptions = {
  readonly minSize?: ResizablePaneLayout
  readonly maxSize?: ResizablePaneLayout
  readonly createHandle?: ConstructorParameters<typeof ResizablePaneGroup>[1]['createHandle']
  readonly onLayoutChange?: (layout: ResizablePaneLayout) => void
  readonly onLayoutChanged?: (layout: ResizablePaneLayout) => void
}

function createGroup(ids: readonly string[], options: CreateGroupOptions = {}) {
  const container = document.createElement('div')
  setRect(container, 1000, 500)
  document.body.appendChild(container)

  const panes = ids.map((id) => {
    const element = document.createElement('section')
    return {
      id,
      element,
      minSize: options.minSize?.[id],
      maxSize: options.maxSize?.[id],
    }
  })
  const group = new ResizablePaneGroup(container, {
    panes,
    createHandle: options.createHandle,
    onLayoutChange: options.onLayoutChange,
    onLayoutChanged: options.onLayoutChanged,
  })
  const handle = container.querySelector<HTMLElement>('[data-editor-pane-handle]')
  if (!handle) throw new Error('Expected a resizable pane handle')
  return { container, group, handle, panes }
}

function setRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => undefined,
    }) as DOMRect
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: { readonly clientX: number; readonly clientY?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY ?? 0,
    button: 0,
  })
  target.dispatchEvent(event)
}
