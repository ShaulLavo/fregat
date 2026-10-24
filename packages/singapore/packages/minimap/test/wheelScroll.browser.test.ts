import type { EditorViewContributionContext } from '@singapore-editor/core/extensions'
import { visibleDocumentLineRange } from '../src/layout'
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'
import { createMinimapPlugin } from '../src/index'
import { canUseMinimapWorker } from '../src/workerClient'

const disposables: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose()
})

// Use the published core facade, not a second source import of the native scroll owner.
// This exercises the actual Editor, minimap contribution, worker, and package-boundary wiring.
describe.skipIf(!canUseMinimapWorker())('minimap wheel delegation', () => {
  it('scrolls through the core from both canvas and slider while keeping the minimap outside', async () => {
    const { editor, host, element } = await mount()
    const root = host.querySelector<HTMLElement>('.editor-minimap')!
    expect(root.parentElement).toBe(host)
    expect(element.contains(root)).toBe(false)
    for (const selector of ['.editor-minimap-canvas', '.editor-minimap-slider']) {
      editor.setScrollPosition({ top: 0, left: 0 })
      await waitFor(() => nativeTop(element) === 0)
      const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
      root.querySelector(selector)!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(nativeTop(element)).toBe(120)
      await waitFor(() => editor.getScrollPosition().top >= 120)
      expect(editor.getScrollPosition().top).toBe(120)
    }
  })

  it('maps wrapped document lines through clicks and keeps a slider-centre click stationary', async () => {
    const { editor, host, context } = await mount(true)
    editor.setScrollPosition({ top: 1000 })
    await waitFor(() => context().getSnapshot().viewport.scrollTop === 1000)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const root = host.querySelector<HTMLElement>('.editor-minimap')!
    const slider = root.querySelector<HTMLElement>('.editor-minimap-slider')!
    const before = context().getSnapshot()
    const range = visibleDocumentLineRange(before, before.viewport)
    expect(range.start).toBeLessThan(before.viewport.scrollRow)
    const rect = slider.getBoundingClientRect()
    root.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: rect.top + rect.height / 2,
      }),
    )
    expect(editor.getScrollPosition().top).toBe(1000)
    const lineHeight =
      (root.getBoundingClientRect().height - rect.height) /
      (before.lineCount - (range.end - range.start))
    const target = range.start + 60
    root.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: rect.top + rect.height / 2 + 60.25 * lineHeight,
      }),
    )
    await waitFor(() => {
      const snapshot = context().getSnapshot()
      return visibleDocumentLineRange(snapshot, snapshot.viewport).start === target
    })
    await waitFor(() => {
      const after = slider.getBoundingClientRect()
      const clickedY = rect.top + rect.height / 2 + 60.25 * lineHeight
      return Math.abs(after.top + after.height / 2 - clickedY) < 2
    })
    expect(context().getSnapshot().selections).toEqual(before.selections)
  })

  it('preserves click-to-reveal and slider dragging', async () => {
    const { editor, host } = await mount()
    const root = host.querySelector<HTMLElement>('.editor-minimap')!
    const rect = root.getBoundingClientRect()
    root.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: rect.left + 2,
        clientY: rect.top + rect.height / 2,
      }),
    )
    await waitFor(() => editor.getScrollPosition().top > 0)
    editor.setScrollPosition({ top: 0 })
    await waitFor(() => editor.getScrollPosition().top === 0)
    const slider = root.querySelector<HTMLElement>('.editor-minimap-slider')!
    await waitFor(() => slider.getBoundingClientRect().height > 0)
    const start = slider.getBoundingClientRect()
    slider.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 2,
        clientX: start.left + 2,
        clientY: start.top + 2,
      }),
    )
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 2,
        clientY: start.top + 32,
      }),
    )
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 2,
        clientY: start.top + 32,
      }),
    )
    await waitFor(() => editor.getScrollPosition().top > 0)
  })
})

async function mount(wordWrap = false) {
  let contributionContext: EditorViewContributionContext | undefined
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;position:relative;width:640px;height:260px'
  document.body.append(host)
  const editor = new Editor(host, {
    defaultText: Array.from({ length: 1000 }, (_, line) => `${line} ${'x'.repeat(120)}`).join('\n'),
    lineHeight: 20,
    wordWrap,
    plugins: [
      createMinimapPlugin({ showSlider: 'always' }),
      {
        name: 'capture-minimap-context',
        activate(context) {
          return [
            context.registerViewContribution({
              createContribution(current) {
                contributionContext = current
                return { update() {}, dispose() {} }
              },
            }),
          ]
        },
      },
    ],
  })
  disposables.push(() => {
    editor.dispose()
    host.remove()
  })
  const element = host.querySelector<HTMLDivElement>('.editor')!
  await waitFor(
    () =>
      element.clientHeight > 0 &&
      element.scrollHeight > element.clientHeight &&
      (host.querySelector('.editor-minimap')?.getBoundingClientRect().width ?? 0) > 0,
  )
  // Let the ResizeObserver measurement commit before dispatching input.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  return { editor, host, element, context: () => contributionContext! }
}

function nativeTop(element: HTMLElement): number {
  return Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.get!.call(
    element,
  ) as number
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for the editor viewport')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
