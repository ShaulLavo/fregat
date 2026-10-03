import { browserTestResponses } from '../../editor/scripts/browser-test-responses.ts'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import type { BrowserCommand } from 'vitest/node'
import { defineConfig } from 'vitest/config'

// The file tree's browser tests (its view and the Plan 178 parity tests) drive Chromium's native
// drag and touch state with real input, so they run one file at a time in their own config.
const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
}

const TOUCH_TESTS = 'src/features/workspace/tests/tree-parity-touch.browser.tsx'

type Point = { readonly x: number; readonly y: number }

/** The test iframe's offset in the page, so in-frame client coordinates become page ones. */
async function frameOffset(context: Parameters<BrowserCommand<[]>>[0]): Promise<Point> {
  const frame = await context.frame()
  const box = await (await frame.frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

type CommandPage = Parameters<BrowserCommand<[]>>[0]['page']
const touchSessions = new WeakMap<CommandPage, Awaited<ReturnType<typeof openTouchSession>>>()
const activeTouches = new WeakSet<CommandPage>()
const pausedClocks = new WeakSet<CommandPage>()
// Pausing jumps this far ahead, firing only timers due in that span.
const PAUSE_LEAD_MS = 1_000

// Emulation lives as long as its session, so one session serves every touch of a page.
async function openTouchSession(page: CommandPage) {
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  return session
}

async function touchSession(page: CommandPage) {
  const existing = touchSessions.get(page)
  if (existing) return existing
  const session = await openTouchSession(page)
  touchSessions.set(page, session)
  return session
}

// Real pointer, touch and wheel input at in-frame client coordinates, for the parity tests.
const treeCommands = {
  async treeClock(context, action: 'pause' | 'advance', milliseconds = 0) {
    if (action === 'advance') return context.page.clock.runFor(milliseconds)
    // Recorded first: pauseAt stops the clock before it can throw, and a clock left paused
    // freezes the runner's own timers, so every later file hangs.
    pausedClocks.add(context.page)
    // The page's clock, which runs ahead of this process's once an earlier test advanced it.
    const now = await context.page.evaluate(() => Date.now())
    await context.page.clock.install({ time: now })
    // The running clock passes `now` before pauseAt lands, and pausing in the past throws.
    await context.page.clock.pauseAt(now + PAUSE_LEAD_MS)
  },
  async treeResetInput(context) {
    if (pausedClocks.has(context.page)) await context.page.clock.resume()
    pausedClocks.delete(context.page)
    await context.page.mouse.up()
    const session = touchSessions.get(context.page)
    if (!session) return
    if (activeTouches.has(context.page))
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    activeTouches.delete(context.page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await session.detach()
    touchSessions.delete(context.page)
  },
  async treeMouse(
    context,
    action: 'click' | 'down' | 'move' | 'up',
    point: Point | null,
    options: {
      button?: 'left' | 'middle' | 'right'
      clickCount?: number
      modifiers?: readonly ('Alt' | 'ControlOrMeta' | 'Shift')[]
      steps?: number
    } = {},
  ) {
    const page = context.page
    const modifiers = options.modifiers ?? []
    for (const key of modifiers) await page.keyboard.down(key)
    try {
      if (point) {
        const offset = await frameOffset(context)
        await page.mouse.move(offset.x + point.x, offset.y + point.y, { steps: options.steps ?? 1 })
      }
      const button = options.button ?? 'left'
      if (action === 'click') {
        for (let count = 1; count <= (options.clickCount ?? 1); count += 1) {
          await page.mouse.down({ button, clickCount: count })
          await page.mouse.up({ button, clickCount: count })
        }
      }
      if (action === 'down') await page.mouse.down({ button })
      if (action === 'up') await page.mouse.up({ button })
    } finally {
      for (const key of modifiers.toReversed()) await page.keyboard.up(key)
    }
  },
  async treeReducedMotion(context, reduce: boolean) {
    await context.page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' })
  },
  async treeWheel(context, point: Point, deltaY: number) {
    const offset = await frameOffset(context)
    await context.page.mouse.move(offset.x + point.x, offset.y + point.y)
    await context.page.mouse.wheel(0, deltaY)
  },
  async treeTouch(
    context,
    type: 'touchCancel' | 'touchEnd' | 'touchMove' | 'touchStart',
    point: Point,
  ) {
    const offset = await frameOffset(context)
    const session = await touchSession(context.page)
    const touchPoints =
      type === 'touchEnd' || type === 'touchCancel'
        ? []
        : [{ x: offset.x + point.x, y: offset.y + point.y }]
    await session.send('Input.dispatchTouchEvent', { type, touchPoints })
    if (type === 'touchStart') activeTouches.add(context.page)
    if (type === 'touchEnd' || type === 'touchCancel') activeTouches.delete(context.page)
  },
} satisfies Record<string, BrowserCommand<never[]>>

export default defineConfig({
  plugins: [browserTestResponses(), react({ compiler: true }), tailwindcss()],
  resolve: { alias, dedupe: ['react', 'react-dom'] },
  // Found mid-run, a dependency reloads the page and fails the file that found it.
  optimizeDeps: { include: ['@workspace/ui > @base-ui/react/context-menu'] },
  test: {
    // Chromium's native drag and touch state must not overlap another file's input.
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      screenshotFailures: false,
      commands: treeCommands,
      instances: [{ browser: 'chromium', viewport: { height: 600, width: 560 } }],
    },
    // A page that has seen touch input matches `(hover: none)` for the rest of the run, which
    // turns off every `hover:` style, so touch runs last, in its own project.
    projects: [
      {
        extends: true,
        test: {
          name: 'tree-browser',
          include: [
            'src/features/workspace/tests/tree-view*.browser.tsx',
            'src/features/workspace/tests/tree-parity-*.browser.tsx',
          ],
          exclude: [TOUCH_TESTS],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'tree-browser-touch',
          include: [TOUCH_TESTS],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
