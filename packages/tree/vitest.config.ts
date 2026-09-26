import path from 'node:path'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import type { BrowserCommand } from 'vitest/node'
import { defineConfig } from 'vitest/config'

const alias = {
  '@workspace/tree': path.resolve(import.meta.dirname, './src'),
}

type Point = { readonly x: number; readonly y: number }

/** The test iframe's offset in the page, so in-frame client coordinates become page ones. */
async function frameOffset(context: Parameters<BrowserCommand<[]>>[0]): Promise<Point> {
  const frame = await context.frame()
  const box = await (await frame.frameElement()).boundingBox()
  return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

type CommandPage = Parameters<BrowserCommand<[]>>[0]['page']
const touchSessions = new WeakMap<CommandPage, Awaited<ReturnType<typeof openTouchSession>>>()

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
  },
} satisfies Record<string, BrowserCommand<never[]>>

// The compiler runs here because it runs in the app that mounts this fork: without it a test
// exercises unmemoized source, and manual memoization the compiler makes redundant looks load-bearing.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react({ compiler: true })],
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          exclude: ['src/**/*.browser.tsx'],
        },
      },
      {
        plugins: [react({ compiler: true })],
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            screenshotFailures: false,
            commands: treeCommands,
            instances: [{ browser: 'chromium', viewport: { height: 600, width: 560 } }],
          },
        },
      },
    ],
  },
})
