import { expect, test } from 'vitest'
import '../src/style.css'
import { Editor } from '../src/editor/Editor'
import type { EditorViewContributionContext, EditorViewSnapshot } from '../src/plugins'

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

function mountEditor(
  update?: (context: EditorViewContributionContext, snapshot: EditorViewSnapshot) => void,
) {
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;width:640px;height:240px;--editor-font-size:13px'
  document.body.append(host)
  const seen: { snapshot: EditorViewSnapshot | null } = { snapshot: null }
  const editor = new Editor(host, {
    plugins: [
      {
        name: 'font-layout-probe',
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (contributionContext) => ({
              update: (snapshot) => {
                seen.snapshot = snapshot
                update?.(contributionContext, snapshot)
              },
              dispose: () => {},
            }),
          }),
      },
    ],
  })
  editor.setText('abcdefghij\nklmnopqrst')
  const scroll = host.querySelector<HTMLElement>('.editor-virtualized')!
  return {
    host,
    editor,
    scroll,
    metrics: () => seen.snapshot!.metrics,
    dispose: () => {
      editor.dispose()
      host.remove()
    },
  }
}

function changeFaceAfterFrame(host: HTMLElement, size: number): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      host.style.setProperty('--editor-font-size', `${size}px`)
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  })
}

test('a host CSS face change updates metrics and hit tests before that frame paints', async () => {
  const { host, editor, scroll, metrics, dispose } = mountEditor()
  try {
    await frames()
    const before = metrics().characterWidth
    expect(before).toBeGreaterThan(0)
    await changeFaceAfterFrame(host, 26)

    expect(getComputedStyle(scroll).fontSize).toBe('26px')
    expect(metrics().characterWidth).toBeCloseTo(before * 2, 1)
    const row = scroll.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')!
    const text = Array.from(row.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!
    const glyph = document.createRange()
    glyph.setStart(text, 5)
    glyph.setEnd(text, 6)
    const rect = glyph.getBoundingClientRect()
    expect(editor.textOffsetFromPoint(rect.left + 1, rect.top + rect.height / 2)).toBe(5)
  } finally {
    dispose()
  }
})

test('font invalidation can resize an observed ancestor without dropping its resize notification', async () => {
  const errors: string[] = []
  const onError = (event: ErrorEvent) => errors.push(event.message)
  window.addEventListener('error', onError)
  const { host, scroll, metrics, dispose } = mountEditor((context, snapshot) => {
    context.reserveOverlayWidth('right', Math.ceil(snapshot.metrics.characterWidth * 10))
  })
  let contentWidth = 0
  const viewport = new ResizeObserver(([entry]) => {
    contentWidth = entry!.contentRect.width
  })
  viewport.observe(scroll)
  try {
    await frames()
    await expect.poll(() => contentWidth).toBeLessThan(640)
    const initialWidth = contentWidth
    const initialCharacterWidth = metrics().characterWidth
    expect(errors).toEqual([])

    host.style.setProperty('--editor-font-size', '26px')
    await frames()
    await expect.poll(() => contentWidth).toBeLessThan(initialWidth)
    expect(metrics().characterWidth).toBeCloseTo(initialCharacterWidth * 2, 1)
    expect(contentWidth).toBeCloseTo(640 - Number.parseFloat(scroll.style.paddingRight), 3)
    expect(errors).toEqual([])
  } finally {
    viewport.disconnect()
    window.removeEventListener('error', onError)
    dispose()
  }
})

test('disposing an editor cancels its pending overlay reservation', async () => {
  const { host, scroll, metrics, dispose } = mountEditor((context, snapshot) => {
    context.reserveOverlayWidth('right', Math.ceil(snapshot.metrics.characterWidth * 10))
  })
  const request = window.requestAnimationFrame
  const cancel = window.cancelAnimationFrame
  const pending = new Set<number>()
  const cancelled = new Set<number>()
  try {
    await frames()
    const before = metrics().characterWidth
    const paddingBefore = scroll.style.paddingRight
    window.requestAnimationFrame = (callback) => {
      const handle = request.call(window, (time) => {
        pending.delete(handle)
        callback(time)
      })
      pending.add(handle)
      return handle
    }
    window.cancelAnimationFrame = (handle) => {
      pending.delete(handle)
      cancelled.add(handle)
      cancel.call(window, handle)
    }
    await changeFaceAfterFrame(host, 26)
    expect(metrics().characterWidth).toBeCloseTo(before * 2, 1)
    expect(scroll.style.paddingRight).toBe(paddingBefore)
    const reservations = Array.from(pending)
    expect(reservations.length).toBeGreaterThan(0)

    dispose()

    expect(pending.size).toBe(0)
    for (const handle of reservations) expect(cancelled.has(handle)).toBe(true)
    const disposedPadding = scroll.style.paddingRight
    await frames()
    expect(scroll.style.paddingRight).toBe(disposedPadding)
  } finally {
    dispose()
    window.requestAnimationFrame = request
    window.cancelAnimationFrame = cancel
  }
})
