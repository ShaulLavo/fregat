import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { GhosttyTerminal } from '../../core/terminal.js'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import {
  captureNativeLinkSnapshot,
  captureNativeLinkDiscovery,
  createProjectedLinkSession,
  type LinkProjection,
  type NativeLinkSnapshotSource,
} from '../../term/link-snapshot.js'
import type { ProvidedLink } from '../../term/links.js'
import { TerminalSession } from '../../term/session.js'
import { createDomLinkController, type DomLinkSession } from '../links.js'
import type { CommittedPointerLayout } from '../pointer.js'
import { Terminal } from '../terminal.js'

let runtime: GhosttyRuntime
const cleanups: Array<() => void> = []

beforeAll(async () => {
  runtime = await GhosttyRuntime.create()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

afterAll(() => runtime.dispose())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function harness(
  adapt?: (session: TerminalSession<Event>, getProjection: () => LinkProjection) => DomLinkSession,
  cursor = '',
) {
  const session = await TerminalSession.create<Event>({
    runtime: { kind: 'borrowed', runtime },
    appearance: { grid: { columns: 30, rows: 2 } },
  })
  cleanups.push(() => session.dispose())
  session.write('link label')
  session.renderState.update()
  const snapshot = {
    cursor: session.renderState.readCursor(),
    rows: session.renderState.readTextRows!({ dirtyOnly: false }),
  }
  const root = document.createElement('div')
  root.style.cssText = 'position:relative;width:300px;height:40px'
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 40
  canvas.style.cssText = 'display:block;width:300px;height:40px'
  canvas.style.cursor = cursor
  root.append(canvas)
  document.body.append(root)
  cleanups.push(() => root.remove())
  const layout: CommittedPointerLayout = {
    canvas,
    grid: { cellHeight: 20, cellWidth: 10, columns: 30, pixelRatio: 1, rows: 2 },
    physical: {
      deviceCellHeight: 20,
      deviceCellWidth: 10,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      screenHeight: 40,
      screenWidth: 300,
    },
  }
  let projection = { generation: 1, layout: 1, revision: session.revision }
  const options = {
    canvas,
    getLayout: () => layout,
    getProjection: () => projection,
    root,
    session: adapt ? adapt(session, () => projection) : session,
  }
  const controller = createDomLinkController(options)
  cleanups.push(() => controller.dispose())
  controller.updateFrame(snapshot)
  return {
    canvas,
    controller,
    root,
    session,
    projection: () => projection,
    setProjection: (value: typeof projection) => {
      projection = value
    },
    move: (column = 0, row = 0) => {
      const bounds = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: bounds.left + (column + 0.5) * 10,
          clientY: bounds.top + (row + 0.5) * 20,
        }),
      )
    },
  }
}

function observeCursorWrites(canvas: HTMLCanvasElement) {
  const style = canvas.style
  const original = Object.getOwnPropertyDescriptor(style, 'cursor')
  const writes = vi.fn((value: string) => style.setProperty('cursor', value))
  Object.defineProperty(style, 'cursor', {
    configurable: true,
    get: () => style.getPropertyValue('cursor'),
    set: writes,
  })
  cleanups.push(() => {
    if (original) Object.defineProperty(style, 'cursor', original)
    else Reflect.deleteProperty(style, 'cursor')
  })
  return writes
}

describe('link cursor writes', () => {
  it('makes no cursor writes on link-free terminal edit frames', async () => {
    const root = document.createElement('div')
    root.style.cssText = 'width:300px;height:80px'
    document.body.append(root)
    cleanups.push(() => root.remove())
    const terminal = await Terminal.create({
      appearance: { grid: { columns: 30, rows: 4 }, cursor: { blink: false } },
      rendererFactory: DomTerminalRenderer.create,
      runtime: { kind: 'borrowed', runtime },
    })
    cleanups.push(() => terminal.dispose())
    await terminal.open(root)
    expect(terminal.diagnostics.rendererBackend).toBe('dom')
    terminal.write('ready')
    await expect.poll(() => terminal.submittedFrame?.rows[0]?.text.startsWith('ready')).toBe(true)
    const writes = observeCursorWrites(terminal.canvas!)
    const counts: number[] = []
    for (let tick = 0; tick < 8; tick += 1) {
      const before = writes.mock.calls.length
      const text = `edit ${tick}`
      terminal.write(`\u001b[H${text}`)
      await expect.poll(() => terminal.submittedFrame?.rows[0]?.text.startsWith(text)).toBe(true)
      counts.push(writes.mock.calls.length - before)
    }
    expect(counts).toEqual(Array<number>(8).fill(0))
  })

  it('preserves host and author cursors while no link is visible', async () => {
    const view = await harness()
    view.root.style.cursor = 'crosshair'
    const writes = observeCursorWrites(view.canvas)
    view.controller.invalidate()
    expect(writes).not.toHaveBeenCalled()
    expect(getComputedStyle(view.canvas).cursor).toBe('crosshair')
    view.canvas.style.cursor = 'wait'
    writes.mockClear()
    view.move()
    view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
    view.controller.invalidate()
    expect(writes).not.toHaveBeenCalled()
    expect(view.canvas.style.cursor).toBe('wait')
    view.controller.dispose()
    expect(writes).not.toHaveBeenCalled()
  })

  it.each(['', 'text', 'pointer'])(
    'writes only changed cursor values on hover and leave with initial cursor %j',
    async (cursor) => {
      const view = await harness(undefined, cursor)
      view.session.registerLinkProvider({
        provideLinks: () => [{ range: { start: 0, end: 9 }, activate: () => {} }],
      })
      const writes = observeCursorWrites(view.canvas)
      view.move()
      await expect.poll(() => view.controller.currentHit !== undefined).toBe(true)
      expect(view.canvas.style.cursor).toBe('pointer')
      view.move(1)
      await expect.poll(() => view.controller.hasPendingResolution).toBe(false)
      view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
      expect(view.controller.currentHit).toBeUndefined()
      expect(view.root.querySelector('[role="link"]')).toBeNull()
      expect(view.canvas.style.cursor).toBe(cursor)
      view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
      view.controller.invalidate()
      expect(writes.mock.calls.map(([value]) => value)).toEqual(
        cursor === 'pointer' ? [] : ['pointer', cursor, 'pointer', cursor],
      )
    },
  )

  it('reads the actual inline cursor after host changes during hover', async () => {
    const view = await harness(undefined, 'text')
    view.session.registerLinkProvider({
      provideLinks: () => [{ range: { start: 0, end: 9 }, activate: () => {} }],
    })
    view.move()
    await expect.poll(() => view.controller.currentHit !== undefined).toBe(true)
    const writes = observeCursorWrites(view.canvas)
    view.canvas.style.cursor = 'text'
    writes.mockClear()
    view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
    expect(writes).not.toHaveBeenCalled()
    view.move()
    await expect.poll(() => view.controller.currentHit !== undefined).toBe(true)
    expect(view.canvas.style.cursor).toBe('pointer')
    view.canvas.style.cursor = 'wait'
    writes.mockClear()
    view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
    expect(view.canvas.style.cursor).toBe('text')
    expect(writes.mock.calls).toEqual([['text']])
  })

  it('keeps hover and modifier-key activation after a host cursor change', async () => {
    const view = await harness(undefined, 'text')
    let activations = 0
    view.session.registerLinkProvider({
      provideLinks: () => [
        {
          range: { start: 0, end: 9 },
          activate: () => {
            activations += 1
          },
        },
      ],
    })
    view.canvas.style.cursor = 'crosshair'
    view.move()
    await expect.poll(() => view.controller.currentHit !== undefined).toBe(true)
    expect(view.canvas.style.cursor).toBe('pointer')
    await page.elementLocator(view.canvas).click({ position: { x: 5, y: 10 } })
    expect(activations).toBe(0)
    const apple = /^(Mac|iPhone|iPad|iPod)/iu.test(navigator.platform)
    await page.elementLocator(view.canvas).click({
      modifiers: [apple ? 'Meta' : 'Control'],
      position: { x: 5, y: 10 },
    })
    await expect.poll(() => activations).toBe(1)
    view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
    expect(view.canvas.style.cursor).toBe('text')
  })
})

describe('committed link projection', () => {
  it('discovers and activates a real session provider link', async () => {
    const view = await harness()
    let activated = 0
    view.session.registerLinkProvider({
      provideLinks: () => [
        {
          activate: () => {
            activated += 1
          },
          range: { start: 0, end: 9 },
          text: 'link label',
        },
      ],
    })
    await expect(view.controller.focusNextLink()).resolves.toBe(true)
    const overlay = view.root.querySelector<HTMLElement>('[role="link"]')!
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect.poll(() => activated).toBe(1)
  })

  it.each(['generation', 'layout', 'revision'] as const)(
    'rejects a provider completion after committed %s changes',
    async (field) => {
      const view = await harness()
      const pending = deferred<readonly ProvidedLink<Event>[]>()
      let requests = 0
      view.session.registerLinkProvider({
        provideLinks: () => {
          requests += 1
          return pending.promise
        },
      })
      const discovery = view.controller.focusNextLink()
      await expect.poll(() => requests).toBe(1)
      const old = view.projection()
      view.setProjection({ ...old, [field]: old[field] + 1 })
      pending.resolve([{ activate: () => {}, range: { start: 0, end: 9 } }])
      await expect(discovery).resolves.toBe(false)
      expect(view.root.querySelector('[role="link"]')).toBeNull()
      expect(view.controller.hasPendingResolution).toBe(false)
      expect(requests).toBe(1)
    },
  )
})

describe('async link currency and lifecycle', () => {
  it('awaits actual session currency before showing a hover', async () => {
    const gate = deferred<void>()
    let currencyChecks = 0
    const view = await harness((session) => ({
      resolveLink: (request) => session.resolveLink(request),
      isLinkCurrent: async (resolution) => {
        currencyChecks += 1
        await gate.promise
        return session.isLinkCurrent(resolution)
      },
      activateLink: (resolution, event) => session.activateLink(resolution, event),
    }))
    view.session.registerLinkProvider({
      provideLinks: () => [
        {
          range: { start: 0, end: 9 },
          activate: () => {},
        },
      ],
    })
    view.move()
    await expect.poll(() => currencyChecks).toBe(1)
    expect(view.root.querySelector('[role="link"]')).toBeNull()
    expect(view.controller.hasPendingResolution).toBe(true)
    view.session.write('\u001b[2J\u001b[Hchanged')
    gate.resolve()
    await expect.poll(() => view.controller.hasPendingResolution).toBe(false)
    expect(view.root.querySelector('[role="link"]')).toBeNull()
  })

  it.each(['projection', 'leave', 'invalidate', 'dispose'] as const)(
    'does not activate after %s while currency validation awaits',
    async (change) => {
      const gate = deferred<void>()
      let currencyChecks = 0
      let activations = 0
      const view = await harness((session) => ({
        resolveLink: (request) => session.resolveLink(request),
        isLinkCurrent: async (resolution) => {
          currencyChecks += 1
          if (currencyChecks > 1) await gate.promise
          return session.isLinkCurrent(resolution)
        },
        activateLink: (resolution, event) => session.activateLink(resolution, event),
      }))
      view.session.registerLinkProvider({
        provideLinks: () => [
          {
            range: { start: 0, end: 9 },
            activate: () => {
              activations += 1
            },
          },
        ],
      })
      view.move()
      await expect.poll(() => view.root.querySelector('[role="link"]') !== null).toBe(true)
      view.root
        .querySelector<HTMLElement>('[role="link"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await expect.poll(() => currencyChecks).toBe(2)
      if (change === 'projection') view.setProjection({ ...view.projection(), layout: 2 })
      if (change === 'leave') view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
      if (change === 'invalidate') view.controller.invalidate()
      if (change === 'dispose') view.controller.dispose()
      gate.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(activations).toBe(0)
    },
  )

  it.each(['leave', 'invalidate', 'dispose'] as const)(
    'does not restore a pending hover or resume discovery after %s',
    async (change) => {
      const pending = deferred<readonly ProvidedLink<Event>[]>()
      let providerCalls = 0
      const view = await harness()
      view.session.registerLinkProvider({
        provideLinks: () => {
          providerCalls += 1
          return pending.promise
        },
      })
      view.move()
      await expect.poll(() => providerCalls).toBe(1)
      if (change === 'leave') view.canvas.dispatchEvent(new PointerEvent('pointerleave'))
      if (change === 'invalidate') view.controller.invalidate()
      if (change === 'dispose') view.controller.dispose()
      pending.resolve([{ range: { start: 0, end: 9 }, activate: () => {} }])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(view.root.querySelector('[role="link"]')).toBeNull()
      expect(view.controller.hasPendingResolution).toBe(false)
      expect(providerCalls).toBe(1)
    },
  )
})

it('renders and activates a real native OSC link in the main terminal', async () => {
  const root = document.createElement('div')
  root.style.cssText = 'width:480px;height:120px;background:#151515;color:#eee'
  document.body.append(root)
  cleanups.push(() => root.remove())
  const activations: string[] = []
  const terminal = await Terminal.create({
    appearance: { grid: { columns: 40, rows: 4 }, cursor: { blink: false } },
    links: {
      activateUri: (uri) => {
        activations.push(uri)
      },
    },
    runtime: { kind: 'borrowed', runtime },
  })
  cleanups.push(() => terminal.dispose())
  await terminal.open(root)
  terminal.write(
    'OSC 8: \u001b]8;;https://native.test\u0007Native link label\u001b]8;;\u0007\r\nBuilt-in URL: https://text.test',
  )
  await expect.poll(() => terminal.submittedFrame?.rows[0]?.text.startsWith('OSC 8:')).toBe(true)
  await expect(terminal.focusNextLink()).resolves.toBe(true)
  const overlay = root.querySelector<HTMLElement>('[role="link"]')!
  expect(overlay.getAttribute('aria-label')).toBe('Native link label')
  overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => activations).toEqual(['https://native.test'])
  await page.screenshot({ path: '.artifacts/links-real-terminal.png' })
})

it.each(['link-free', 'late-link'] as const)(
  'uses one projected discovery batch from the DOM controller for %s',
  async (kind) => {
    let batches = 0
    let hoverRequests = 0
    const view = await harness((session, getProjection) => {
      const terminal = Reflect.get(session, 'terminal') as GhosttyTerminal
      const source: NativeLinkSnapshotSource = {
        get revision() {
          return session.revision
        },
        get grid() {
          return session.grid
        },
        renderState: session.renderState,
        linkAt: (column, row) => terminal.linkAt({ x: column, y: row, tag: 'viewport' }),
      }
      const host = createProjectedLinkSession({
        getProjection,
        resolveLinkSnapshot: async (request) => {
          hoverRequests += 1
          return captureNativeLinkSnapshot(source, request, getProjection)
        },
        resolveLinkDiscovery: async (request) => {
          batches += 1
          return captureNativeLinkDiscovery(source, request, getProjection)
        },
      })
      cleanups.push(() => host.dispose())
      if (kind === 'late-link')
        host.registerLinkProvider({
          provideLinks: (_line, row) => {
            if (row !== 1) return []
            return [{ range: { start: 29, end: 29 }, text: 'last cell', activate: () => {} }]
          },
        })
      return host
    })
    await expect(view.controller.focusNextLink()).resolves.toBe(kind === 'late-link')
    expect(batches).toBe(1)
    expect(hoverRequests).toBe(0)
    if (kind === 'late-link')
      expect(view.root.querySelector('[role="link"]')?.getAttribute('aria-label')).toBe('last cell')
  },
)
