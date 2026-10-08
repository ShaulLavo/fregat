import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import { TerminalSession } from '../../term/session.js'
import { createTerminalElements, type TerminalElements } from '../elements.js'
import { createGhosttyWebGpuTerminalFromSession } from '../terminal.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function mountedHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.style.width = '400px'
  host.style.height = '320px'
  document.body.append(host)
  cleanups.push(() => host.remove())
  return host
}

function observeStyles(element: HTMLElement): () => MutationRecord[] {
  const records: MutationRecord[] = []
  const observer = new MutationObserver((changes) => records.push(...changes))
  observer.observe(element, { attributes: true, attributeFilter: ['style'] })
  cleanups.push(() => observer.disconnect())
  return () => records.splice(0).concat(observer.takeRecords())
}

async function compositionProbe() {
  const host = mountedHost()
  const elements = createTerminalElements(host)
  let composition = elements.compositionView!
  const supplied: TerminalElements = {
    root: elements.root,
    textarea: elements.textarea,
    signal: elements.signal,
    get canvas() {
      return elements.canvas
    },
    get compositionView() {
      return composition
    },
    get padding() {
      return elements.padding
    },
    dispose: () => elements.dispose(),
    setPadding: (padding) => elements.setPadding(padding),
    positionTextarea: (position) => {
      elements.positionTextarea(position)
      composition.style.left = elements.textarea.style.left
      composition.style.top = elements.textarea.style.top
    },
  }
  const session = await TerminalSession.create<Event>({
    appearance: {
      cursor: { blink: false },
      font: { family: 'monospace', size: 15 },
      grid: { columns: 40, rows: 12 },
    },
  })
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    accessibility: false,
    autoFit: false,
    elements: supplied,
    rendererFactory: (options) => DomTerminalRenderer.create(options),
  })
  cleanups.push(() => terminal.dispose())
  await terminal.open(host)
  const frame = host.querySelector<HTMLDivElement>('.ghostty-webgpu-frame')!
  terminal.write('\x1b[6;1H\x1b[2Kedit 0000')
  await vi.waitFor(() => expect(frame.textContent).toContain('edit 0000'))
  return {
    composition: () => composition,
    update: async () => {
      terminal.write('\x1b[6;1H\x1b[2Kedit 0001')
      await vi.waitFor(() => expect(frame.textContent).toContain('edit 0001'))
    },
    replace: () => {
      const next = document.createElement('div')
      next.className = 'ghostty-webgpu-composition'
      next.hidden = true
      composition.replaceWith(next)
      composition = next
      return next
    },
  }
}

describe('terminal UI declarations', () => {
  it('restores caret declarations after exposed inline styles change', () => {
    const elements = createTerminalElements(mountedHost())
    cleanups.push(() => elements.dispose())
    elements.positionTextarea({ x: 10, y: 20 })
    elements.textarea.style.removeProperty('left')
    elements.compositionView!.style.top = '0px'
    elements.positionTextarea({ x: 10, y: 20 })
    expect(elements.textarea.style.left).toBe('10px')
    expect(elements.compositionView!.style.top).toBe('20px')
  })

  it('restores preedit appearance after exposed inline styles change', async () => {
    const probe = await compositionProbe()
    expect(probe.composition().style.fontSize).toBe('15px')
    probe.composition().style.removeProperty('font-size')
    await probe.update()
    expect(probe.composition().style.fontSize).toBe('15px')
  })

  it('restores preedit appearance after a peer callback in the same native frame', async () => {
    const probe = await compositionProbe()
    requestAnimationFrame(() => probe.composition().style.removeProperty('font-size'))
    await probe.update()
    expect(probe.composition().style.fontSize).toBe('15px')
  })

  it('applies appearance to a replacement supplied composition element', async () => {
    const probe = await compositionProbe()
    expect(probe.composition().style.fontSize).toBe('15px')
    const next = probe.replace()
    await probe.update()
    expect(next.style.fontSize).toBe('15px')
    expect(next.style.minWidth).not.toBe('')
  })
  it('retains preedit appearance during row edits with unchanged font and theme', async () => {
    const session = await TerminalSession.create<Event>({
      appearance: {
        cursor: { blink: false },
        font: { family: 'monospace', size: 15 },
        grid: { columns: 40, rows: 12 },
      },
    })
    const terminal = createGhosttyWebGpuTerminalFromSession(session, {
      accessibility: false,
      autoFit: false,
      rendererFactory: (options) => DomTerminalRenderer.create(options),
    })
    cleanups.push(() => terminal.dispose())
    const host = mountedHost()
    await terminal.open(host)
    const preedit = host.querySelector<HTMLDivElement>('.ghostty-webgpu-composition')!
    const frame = host.querySelector<HTMLDivElement>('.ghostty-webgpu-frame')!
    terminal.write('\x1b[6;1H\x1b[2Kedit 0000')
    await vi.waitFor(() => expect(frame.textContent).toContain('edit 0000'))
    const before = preedit.getAttribute('style')
    const changes = observeStyles(preedit)
    const declaration = preedit.style
    const styleReads = vi.spyOn(preedit, 'style', 'get')
    expect(preedit.style).toBe(declaration)
    styleReads.mockClear()
    terminal.write('\x1b[6;1H\x1b[2Kedit 0001')
    await vi.waitFor(() => expect(frame.textContent).toContain('edit 0001'))
    expect(preedit.getAttribute('style')).toBe(before)
    expect(changes()).toEqual([])
    // The one read belongs to caret positioning; appearance does no declaration work.
    expect(styleReads).toHaveBeenCalledTimes(1)
  })

  it('keeps owned caret declarations until validated coordinates change', () => {
    const elements = createTerminalElements(mountedHost())
    cleanups.push(() => elements.dispose())
    elements.positionTextarea({ x: 10, y: 20 })
    const inputChanges = observeStyles(elements.textarea)
    const compositionChanges = observeStyles(elements.compositionView!)
    elements.positionTextarea({ x: 10, y: 20 })
    expect(inputChanges()).toEqual([])
    expect(compositionChanges()).toEqual([])
    elements.positionTextarea({ x: 12, y: 24 })
    expect(elements.textarea.style.left).toBe('12px')
    expect(elements.compositionView!.style.top).toBe('24px')
    elements.positionTextarea({ x: -1, y: -2 })
    expect(elements.textarea.style.left).toBe('0px')
    expect(elements.compositionView!.style.top).toBe('0px')
    inputChanges()
    compositionChanges()
    elements.positionTextarea({ x: 0, y: 0 })
    expect(inputChanges()).toEqual([])
    expect(compositionChanges()).toEqual([])
    expect(() => elements.positionTextarea({ x: Number.NaN, y: 0 })).toThrow(RangeError)
    expect(() => elements.positionTextarea({ x: 0, y: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    )
  })
})
