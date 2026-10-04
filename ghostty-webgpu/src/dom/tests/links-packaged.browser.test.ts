import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Terminal as MainTerminal } from '../../../dist/index.js'
import { Terminal as WorkerTerminal } from '../../../dist/worker/index.js'
import type { TerminalApi } from '../../../dist/dom/terminal-api.js'
import { WebGlTerminalRenderer } from '../../../dist/render/webgl/renderer.js'

const family = 'PackagedLinksTest'
const fontUrl = new URL(
  '../../../site/public/fonts/jetbrains-mono-latin-400-normal.woff2',
  import.meta.url,
).href
const assets = {
  wasm: new URL('../../../ghostty-vt.wasm', import.meta.url).href,
  bridge: new URL('../../../bridge.wasm', import.meta.url).href,
}
const terminals: TerminalApi[] = []
const roots: HTMLElement[] = []
const faces: FontFace[] = []

afterEach(async () => {
  for (const terminal of terminals.splice(0)) await terminal.dispose()
  for (const root of roots.splice(0)) root.remove()
  for (const face of faces.splice(0)) document.fonts.delete(face)
})

async function create(mode: 'main' | 'worker', activateUri: (uri: string) => void) {
  const options = {
    appearance: { font: { family, size: 16 }, cursor: { blink: false } },
    links: { activateUri },
  }
  if (mode === 'worker') {
    const terminal = await WorkerTerminal.create({
      ...options,
      assets,
      backend: 'webgl',
      fonts: [{ family, source: { url: fontUrl } }],
    })
    terminals.push(terminal)
    return terminal
  }
  const face = await new FontFace(family, `url(${JSON.stringify(fontUrl)})`).load()
  document.fonts.add(face)
  faces.push(face)
  const terminal = await MainTerminal.create({
    ...options,
    runtime: { kind: 'owned', options: assets },
    rendererFactory: (input) => WebGlTerminalRenderer.create(input),
  })
  terminals.push(terminal)
  return terminal
}

async function open(mode: 'main' | 'worker', activateUri: (uri: string) => void) {
  const terminal = await create(mode, activateUri)
  const root = document.createElement('div')
  root.style.cssText = 'width:480px;height:120px;position:relative;background:#151515'
  document.body.append(root)
  roots.push(root)
  await terminal.open(root)
  return { root, terminal }
}

describe.each(['main', 'worker'] as const)('packaged links %s', (mode) => {
  it('delivers a native OSC8 URI absent from rendered text to the host', async () => {
    const activations: string[] = []
    const { root, terminal } = await open(mode, (uri) => activations.push(uri))
    await terminal.write('\x1b]8;;https://native-only.test/owned\x07Native label\x1b]8;;\x07')
    await expect.poll(() => terminal.submittedFrame?.rows[0]?.text.trimEnd()).toBe('Native label')
    await expect(terminal.focusNextLink()).resolves.toBe(true)
    const overlay = root.querySelector<HTMLElement>('[role="link"]')!
    expect(overlay.getAttribute('aria-label')).toBe('Native label')
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect.poll(() => activations).toEqual(['https://native-only.test/owned'])
    await page.screenshot({ element: root, path: `.artifacts/packaged-links-${mode}.png` })
  }, 20_000)

  it('registers, discovers and activates a provider closure held on the host', async () => {
    const { root, terminal } = await open(mode, () => {})
    let activated = 0
    const registration = terminal.registerLinkProvider({
      provideLinks: (line, row) =>
        row === 0 && line.cells[0]?.text === 'H'
          ? [
              {
                range: { start: 0, end: 9 },
                activate: () => {
                  activated += 1
                },
              },
            ]
          : [],
    })
    expect(typeof registration.token).toBe('symbol')
    await terminal.write('Host label')
    await expect.poll(() => terminal.submittedFrame?.rows[0]?.text.trimEnd()).toBe('Host label')
    await expect(terminal.focusNextLink()).resolves.toBe(true)
    const overlay = root.querySelector<HTMLElement>('[role="link"]')!
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect.poll(() => activated).toBe(1)
    registration.dispose()
    await expect(terminal.focusNextLink()).resolves.toBe(false)
  }, 20_000)
})
