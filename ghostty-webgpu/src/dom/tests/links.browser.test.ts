import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { ProvidedLink } from '../../term/links.js'
import { TerminalSession } from '../../term/session.js'
import { createDomLinkController } from '../links.js'
import type { CommittedPointerLayout } from '../pointer.js'

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

async function harness() {
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
    session,
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
  }
}

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
    await page.screenshot({ path: '.artifacts/links-known-good.png' })
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
