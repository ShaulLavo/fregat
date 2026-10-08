import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import { TerminalSession } from '../../term/session.js'
import { createTerminalElements } from '../elements.js'
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

describe('terminal UI declarations', () => {
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
    const style = vi.spyOn(preedit, 'style', 'get')
    terminal.write('\x1b[6;1H\x1b[2Kedit 0001')
    await vi.waitFor(() => expect(frame.textContent).toContain('edit 0001'))
    expect(preedit.getAttribute('style')).toBe(before)
    expect(style).not.toHaveBeenCalled()
  })

  it('keeps owned caret declarations until validated coordinates change', () => {
    const elements = createTerminalElements(mountedHost())
    cleanups.push(() => elements.dispose())
    elements.positionTextarea({ x: 10, y: 20 })
    const inputStyle = vi.spyOn(elements.textarea, 'style', 'get')
    const compositionStyle = vi.spyOn(elements.compositionView!, 'style', 'get')
    elements.positionTextarea({ x: 10, y: 20 })
    expect(inputStyle).not.toHaveBeenCalled()
    expect(compositionStyle).not.toHaveBeenCalled()
    elements.positionTextarea({ x: 12, y: 24 })
    expect(elements.textarea.style.left).toBe('12px')
    expect(elements.compositionView!.style.top).toBe('24px')
    elements.positionTextarea({ x: -1, y: -2 })
    expect(elements.textarea.style.left).toBe('0px')
    expect(elements.compositionView!.style.top).toBe('0px')
    inputStyle.mockClear()
    compositionStyle.mockClear()
    elements.positionTextarea({ x: 0, y: 0 })
    expect(inputStyle).not.toHaveBeenCalled()
    expect(compositionStyle).not.toHaveBeenCalled()
    expect(() => elements.positionTextarea({ x: Number.NaN, y: 0 })).toThrow(RangeError)
    expect(() => elements.positionTextarea({ x: 0, y: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    )
  })
})
