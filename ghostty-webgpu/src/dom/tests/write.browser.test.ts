import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { GhosttyRuntime } from '../../core/runtime.js'
import { DomTerminalRenderer } from '../../render/dom/renderer.js'
import { TerminalSession } from '../../term/session.js'
import type { TerminalScrollbarController } from '../scrollbar.js'
import { createGhosttyWebGpuTerminalFromSession } from '../terminal.js'

const cleanups: Array<() => void> = []
let runtime: GhosttyRuntime

beforeAll(async () => {
  runtime = await GhosttyRuntime.create()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

afterAll(() => runtime.dispose())

async function mountedTerminal() {
  const host = document.createElement('div')
  host.style.width = '400px'
  host.style.height = '160px'
  document.body.append(host)
  cleanups.push(() => host.remove())
  const session = await TerminalSession.create({
    appearance: {
      cursor: { blink: false },
      grid: { columns: 30, rows: 4 },
    },
    runtime: { kind: 'borrowed', runtime },
  })
  cleanups.push(() => session.dispose())
  const terminal = createGhosttyWebGpuTerminalFromSession(session, {
    accessibility: false,
    autoFit: false,
    rendererFactory: (options) => DomTerminalRenderer.create(options),
  })
  cleanups.push(() => terminal.dispose())
  await terminal.open(host)
  await expect.poll(() => terminal.hasPendingFrame).toBe(false)
  const controller: unknown = Reflect.get(terminal, 'scrollbar')
  if (!controller || typeof controller !== 'object' || !('update' in controller))
    throw new TypeError('Expected the mounted scrollbar controller')
  if (typeof controller.update !== 'function')
    throw new TypeError('Expected the scrollbar update method')
  const update = vi.spyOn(controller as Pick<TerminalScrollbarController, 'update'>, 'update')
  cleanups.push(() => update.mockRestore())
  return { host, session, terminal, update }
}

it.each(['write', 'writeln'] as const)(
  '%s leaves an unchanged scroll snapshot with its session owner',
  async (method) => {
    const { host, terminal, update } = await mountedTerminal()
    terminal[method]('\x1b[32mgreen\x1b[0m')
    expect(update).toHaveBeenCalledTimes(0)
    await expect.poll(() => terminal.hasPendingFrame).toBe(false)
    expect(terminal.visibleLines()[0]).toContain('green')
    expect(host.querySelector('.ghostty-webgpu-frame [data-row="0"]')?.textContent).toContain(
      'green',
    )
    expect(host.querySelector('[role="scrollbar"]')?.getAttribute('aria-valuenow')).toBe('0')
  },
)

it.each(['write', 'writeln'] as const)(
  '%s publishes a changed scrollbar once before the frame',
  async (method) => {
    const { host, session, terminal, update } = await mountedTerminal()
    terminal[method]('one\r\ntwo\r\nthree\r\nfour\r\nfive')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenLastCalledWith(session.scrollbar)
    const track = host.querySelector('[role="scrollbar"]')
    expect(track?.getAttribute('aria-valuenow')).toBe(String(session.scrollbar.offset))
    await expect.poll(() => terminal.hasPendingFrame).toBe(false)
    expect(terminal.visibleLines().join('\n')).toContain('five')
    expect(host.querySelector('.ghostty-webgpu-frame')?.textContent).toContain('five')
    await page.screenshot({ path: `../../../.artifacts/dom-${method}-scroll-snapshot.png` })
  },
)

it('settles output written by a scroll observer on the published snapshot', async () => {
  const { host, session, terminal, update } = await mountedTerminal()
  const subscription = terminal.on('scroll', () => terminal.write(' nested'))
  cleanups.push(() => subscription.dispose())
  terminal.write('one\r\ntwo\r\nthree\r\nfour\r\nfive')
  expect(update).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenLastCalledWith(session.scrollbar)
  await expect.poll(() => terminal.hasPendingFrame).toBe(false)
  expect(host.querySelector('.ghostty-webgpu-frame')?.textContent).toContain('five nested')
  expect(host.querySelector('[role="scrollbar"]')?.getAttribute('aria-valuenow')).toBe(
    String(session.scrollbar.offset),
  )
})
