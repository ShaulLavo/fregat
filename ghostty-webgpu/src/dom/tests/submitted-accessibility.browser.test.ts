import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import { CanvasTerminalRenderer } from '../../render/canvas/renderer.js'
import type { RendererTextFrameSnapshot } from '../../render/renderer.js'
import type { RenderSchedulerClock } from '../../render/scheduler.js'
import { TerminalSession } from '../../term/session.js'
import type { TerminalAccessibilityController } from '../accessibility.js'
import { createTerminalElements } from '../elements.js'
import type { TerminalSubmittedFrame } from '../submitted-frame.js'
import { createGhosttyWebGpuTerminalFromSession, type Terminal } from '../terminal.js'

const escape = '\u001b'
const cleanups: Array<() => void> = []
let runtime: GhosttyRuntime

class DeferredFrameClock implements RenderSchedulerClock {
  private nextHandle = 0
  readonly frames = new Map<number, () => void>()

  cancelFrame(handle: number): void {
    this.frames.delete(handle)
  }

  clearTimer(handle: number): void {
    window.clearTimeout(handle)
  }

  requestFrame(callback: () => void): number {
    const handle = ++this.nextHandle
    this.frames.set(handle, callback)
    return handle
  }

  setTimer(callback: () => void, delayMs: number): number {
    return window.setTimeout(callback, delayMs)
  }

  flush(): void {
    const frames = [...this.frames.values()]
    this.frames.clear()
    for (const callback of frames) callback()
  }
}

beforeAll(async () => {
  runtime = await GhosttyRuntime.create()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

afterAll(() => {
  runtime.dispose()
})

async function fixture() {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px;height:180px;position:relative'
  document.body.append(host)
  cleanups.push(() => host.remove())
  const session = await TerminalSession.create<Event>({
    appearance: {
      cursor: { blink: false },
      font: { family: 'monospace', size: 16 },
      grid: { columns: 20, pixelRatio: 1, rows: 3 },
    },
    runtime: { kind: 'borrowed', runtime },
  })
  cleanups.push(() => session.dispose())
  const background = session.appearance.rendererTheme.background
  host.style.backgroundColor = `rgb(${background.r} ${background.g} ${background.b})`
  const elements = createTerminalElements(host, {
    padding: { bottom: 4, left: 5, right: 6, top: 3 },
  })
  elements.textarea.setAttribute('aria-label', 'Existing input')
  elements.textarea.setAttribute('aria-controls', 'existing-screen')
  elements.textarea.setAttribute('aria-describedby', 'existing-description')
  const clock = new DeferredFrameClock()
  let renderer: CanvasTerminalRenderer | undefined
  const snapshots: RendererTextFrameSnapshot[] = []
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    autoFit: false,
    elements,
    rendererFactory: async (options) => {
      renderer = await CanvasTerminalRenderer.create({
        ...options,
        schedulerClock: clock,
        onTextFrame: (snapshot) => {
          options.onTextFrame?.(snapshot)
          snapshots.push(snapshot)
        },
      })
      return renderer
    },
  })
  cleanups.push(() => terminal.dispose())
  const errors: unknown[] = []
  terminal.on('error', (error) => errors.push(error))
  await terminal.open(host)
  clock.flush()
  expect(renderer).toBeDefined()
  expect(terminal.submittedFrame).toBeDefined()
  return { clock, elements, errors, host, renderer: renderer!, session, snapshots, terminal }
}

type Harness = Awaited<ReturnType<typeof fixture>>

function controller(terminal: Terminal): TerminalAccessibilityController {
  const value = Reflect.get(terminal, 'accessibility') as
    | TerminalAccessibilityController
    | undefined
  expect(value).toBeDefined()
  return value!
}

function submittedSnapshot(terminal: Terminal): RendererTextFrameSnapshot {
  const value = Reflect.get(terminal, 'lastFrame') as RendererTextFrameSnapshot | undefined
  expect(value).toBeDefined()
  return value!
}

function expectDisplayed(harness: Harness, summary: TerminalSubmittedFrame): void {
  const accessibility = controller(harness.terminal)
  const rows = accessibility.rowElements
  expect(accessibility.mirror.getAttribute('role')).toBe('list')
  expect(accessibility.mirror.hasAttribute('aria-hidden')).toBe(false)
  expect(rows.every((row) => row.getAttribute('role') === 'listitem')).toBe(true)
  expect(rows.map((row) => row.textContent)).toEqual(summary.rows.map((row) => row.text.trimEnd()))
  expect(rows.map((row) => row.getAttribute('aria-posinset'))).toEqual(
    summary.rows.map((row) => String(summary.scrollbar.offset + row.y + 1)),
  )
  expect(rows.map((row) => row.getAttribute('aria-setsize'))).toEqual(
    summary.rows.map(() => String(summary.scrollbar.total)),
  )
  expect(rows.map((row) => row.getAttribute('data-row'))).toEqual(
    summary.rows.map((row) => String(summary.scrollbar.offset + row.y)),
  )
  expect(summary.grid.cellWidth).toBe(summary.font.cssCellWidth)
  expect(summary.grid.cellHeight).toBe(summary.font.cssCellHeight)
  const viewport = summary.cursor.viewport
  if (!viewport || !summary.cursor.visible) {
    expect(accessibility.cursorStatus.textContent).toBe('Cursor location unavailable')
    expect(harness.elements.textarea.hasAttribute('aria-activedescendant')).toBe(false)
    expect(rows.every((row) => !row.hasAttribute('aria-current'))).toBe(true)
    return
  }
  const column = viewport.wideTail ? Math.max(0, viewport.x - 1) : viewport.x
  const row = rows[viewport.y]!
  expect(accessibility.cursorStatus.textContent).toBe(
    `Cursor at row ${summary.scrollbar.offset + viewport.y + 1}, column ${column + 1}`,
  )
  expect(harness.elements.textarea.getAttribute('aria-activedescendant')).toBe(row.id)
  expect(row.getAttribute('aria-current')).toBe('true')
  expect(rows.filter((row) => row.hasAttribute('aria-current'))).toHaveLength(1)
  expect(Number.parseFloat(harness.elements.textarea.style.left)).toBeCloseTo(
    summary.padding.left + column * summary.grid.cellWidth,
  )
  expect(Number.parseFloat(harness.elements.textarea.style.top)).toBeCloseTo(
    summary.padding.top + viewport.y * summary.grid.cellHeight,
  )
}

describe('accessibility from real submitted native frames', () => {
  it('retains one displayed subject through pending output and font layout, then announces the new submission', async () => {
    const harness = await fixture()
    const { clock, terminal } = harness
    const accessibility = controller(terminal)
    expect(terminal.write('displayed') instanceof Promise).toBe(false)
    clock.flush()
    const displayed = terminal.submittedFrame!
    const rowIds = accessibility.rowElements.map((row) => row.id)
    expectDisplayed(harness, displayed)
    expect(accessibility.liveRegion.textContent).toBe('displayed')
    accessibility.liveRegion.replaceChildren()

    terminal.write('!')
    harness.session.renderState.update()
    terminal.setFont({ size: 20 })
    expect(terminal.submittedFrame).toBe(displayed)
    expectDisplayed(harness, displayed)
    expect(accessibility.liveRegion.textContent).toBe('')
    clock.flush()

    const next = terminal.submittedFrame!
    expect(next.frame).toBeGreaterThan(displayed.frame)
    expect(next.layout).toBeGreaterThan(displayed.layout)
    expect(next.font.settings.size).toBe(20)
    expect(next.padding).toEqual({ bottom: 4, left: 5, right: 6, top: 3 })
    expect(next.rows[0]?.text.trimEnd()).toBe('displayed!')
    expect(displayed.rows[0]?.text.trimEnd()).toBe('displayed')
    expectDisplayed(harness, next)
    expect(accessibility.rowElements.map((row) => row.id)).toEqual(rowIds)
    expect(accessibility.liveRegion.textContent).toBe('!')
    expect(harness.errors).toEqual([])
    await page.screenshot({
      element: harness.elements.root,
      path: '../../../.artifacts/submitted-accessibility.png',
      scale: 'css',
    })
  })

  it('uses submitted scroll positions and keeps resized grid, font and cursor together until paint', async () => {
    const harness = await fixture()
    const { clock, renderer, session, terminal } = harness
    terminal.write('alpha\r\nbeta\r\ngamma\r\ndelta\r\nepsilon\r\nzeta')
    clock.flush()
    const bottom = terminal.submittedFrame!
    expect(bottom.scrollbar.offset).toBeGreaterThan(0)
    expect(bottom.rows.map((row) => row.text.trimEnd())).toEqual(['delta', 'epsilon', 'zeta'])
    expectDisplayed(harness, bottom)
    const liveRegion = controller(terminal).liveRegion
    liveRegion.replaceChildren()

    expect(terminal.scrollToTop() instanceof Promise).toBe(false)
    expect(session.scrollbar.offset).toBe(0)
    expect(terminal.submittedFrame).toBe(bottom)
    expectDisplayed(harness, bottom)
    clock.flush()
    const top = terminal.submittedFrame!
    expect(top.scrollbar.offset).toBe(0)
    expect(top.rows.map((row) => row.text.trimEnd())).toEqual(['alpha', 'beta', 'gamma'])
    expectDisplayed(harness, top)
    expect(liveRegion.textContent).toBe('')
    expect(terminal.readLines(0, 1)[0]?.text.trimEnd()).toBe('alpha')

    terminal.scrollToBottom()
    clock.flush()
    const beforeResize = terminal.submittedFrame!
    renderer.setDocumentVisible(false)
    terminal.setAppearance({ grid: { columns: 24, rows: 4 } })
    terminal.setFont({ size: 18 })
    expect(terminal.submittedFrame).toBe(beforeResize)
    expectDisplayed(harness, beforeResize)
    renderer.setDocumentVisible(true)
    clock.flush()
    const resized = terminal.submittedFrame!
    expect(resized.layout).toBeGreaterThan(beforeResize.layout)
    expect(resized.grid).toMatchObject({ columns: 24, rows: 4 })
    expect(resized.font.settings.size).toBe(18)
    expect(resized.rows).toHaveLength(4)
    expectDisplayed(harness, resized)
    expect(liveRegion.textContent).toBe('')
    expect(harness.errors).toEqual([])
  })

  it('projects native wide-tail, hidden and restored cursors onto accessible rows and the input caret', async () => {
    const harness = await fixture()
    const { clock, terminal } = harness
    terminal.write(`AB界Z\r\nnext${escape}[1;4H`)
    clock.flush()
    const wide = terminal.submittedFrame!
    expect(wide.rows[0]?.text.trimEnd()).toBe('AB界Z')
    expect(wide.cursor.viewport).toEqual({ x: 3, y: 0, wideTail: true })
    expectDisplayed(harness, wide)
    expect(controller(terminal).cursorStatus.textContent).toBe('Cursor at row 1, column 3')

    terminal.write(`${escape}[?25l`)
    clock.flush()
    expect(terminal.submittedFrame!.cursor.visible).toBe(false)
    expectDisplayed(harness, terminal.submittedFrame!)
    terminal.write(`${escape}[?25h${escape}[2;3H`)
    clock.flush()
    expect(terminal.submittedFrame!.cursor.viewport).toMatchObject({ x: 2, y: 1 })
    expectDisplayed(harness, terminal.submittedFrame!)
    expect(controller(terminal).rowElements[0]?.hasAttribute('aria-current')).toBe(false)
    expect(harness.errors).toEqual([])
  })

  it('hydrates toggles without native queries and rejects late leaf updates and cancelled frame callbacks after disposal', async () => {
    const harness = await fixture()
    const { clock, elements, session, terminal } = harness
    terminal.write('owned rows')
    clock.flush()
    const old = controller(terminal)
    const oldSnapshot = submittedSnapshot(terminal)
    const oldSummary = terminal.submittedFrame!
    const readRows = vi.spyOn(session.renderState, 'readRows')
    const readTextRows = vi.spyOn(session.renderState, 'readTextRows')
    const readLines = vi.spyOn(session, 'readLines')
    const getSelection = vi.spyOn(session, 'getSelection')
    cleanups.push(() => {
      readRows.mockRestore()
      readTextRows.mockRestore()
      readLines.mockRestore()
      getSelection.mockRestore()
    })

    terminal.setAccessibilityEnabled(false)
    expect(elements.textarea.getAttribute('aria-label')).toBe('Existing input')
    expect(elements.textarea.getAttribute('aria-controls')).toBe('existing-screen')
    expect(elements.textarea.getAttribute('aria-describedby')).toBe('existing-description')
    expect(elements.textarea.hasAttribute('aria-activedescendant')).toBe(false)
    terminal.write('!')
    terminal.setAccessibilityEnabled(true)
    expectDisplayed(harness, oldSummary)
    const replacement = controller(terminal)
    expect(replacement).not.toBe(old)
    const attributes = elements.textarea.outerHTML
    old.notifyOutput()
    expect(old.update(oldSnapshot, oldSummary.scrollbar)).toEqual({
      announced: false,
      full: false,
      updatedRows: 0,
    })
    expect(elements.textarea.outerHTML).toBe(attributes)
    expect(replacement.liveRegion.textContent).toBe('')
    expect(readRows).not.toHaveBeenCalled()
    expect(readTextRows).not.toHaveBeenCalled()
    expect(readLines).not.toHaveBeenCalled()
    expect(getSelection).not.toHaveBeenCalled()
    clock.flush()
    expect(terminal.submittedFrame!.rows[0]?.text.trimEnd()).toBe('owned rows!')
    expectDisplayed(harness, terminal.submittedFrame!)

    const snapshot = submittedSnapshot(terminal)
    const summary = terminal.submittedFrame!
    const mirror = replacement.mirror
    terminal.write('late')
    const cancelled = [...clock.frames.values()]
    expect(cancelled.length).toBeGreaterThan(0)
    const frameCount = harness.snapshots.length
    terminal.dispose()
    for (const callback of cancelled) callback()
    replacement.notifyOutput()
    expect(replacement.update(snapshot, summary.scrollbar)).toEqual({
      announced: false,
      full: false,
      updatedRows: 0,
    })
    expect(harness.snapshots).toHaveLength(frameCount)
    expect(mirror.isConnected).toBe(false)
    expect(harness.host.querySelector('[role="list"]')).toBeNull()
    expect(elements.textarea.getAttribute('aria-label')).toBe('Existing input')
    expect(elements.textarea.getAttribute('aria-controls')).toBe('existing-screen')
    expect(elements.textarea.getAttribute('aria-describedby')).toBe('existing-description')
    expect(harness.errors).toEqual([])
  })
})
