import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Terminal as MainTerminal } from '../../dist/index.js'
import { Terminal as WorkerTerminal, TerminalWorkerError } from '../../dist/worker/index.js'
import type { TerminalApi } from '../../dist/dom/terminal-api.js'
import { WebGlTerminalRenderer } from '../../dist/render/webgl/renderer.js'
import type { TerminalOutputReady, TerminalOutputMessage } from './protocol.js'

const family = 'PackagedWorkerTest'
const fontUrl = new URL(
  '../../site/public/fonts/jetbrains-mono-latin-400-normal.woff2',
  import.meta.url,
).href
const workerUrl = new URL('../../dist/worker/entry.js', import.meta.url)
const assets = {
  wasm: new URL('../../ghostty-vt.wasm', import.meta.url).href,
  bridge: new URL('../../bridge.wasm', import.meta.url).href,
}
const active: TerminalApi[] = []
const containers: HTMLElement[] = []
afterEach(async () => {
  for (const terminal of active.splice(0)) await terminal.dispose()
  for (const container of containers.splice(0)) container.remove()
})
function container(): HTMLDivElement {
  const value = document.createElement('div')
  value.style.cssText = 'width:480px;height:160px;position:relative'
  document.body.append(value)
  containers.push(value)
  return value
}
async function eventually(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!(await condition())) {
    if (Date.now() > deadline) expect.fail('Submitted worker frame did not arrive')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
async function create(mode: 'main' | 'webgpu' | 'webgl') {
  const appearance = { font: { family, size: 16 }, cursor: { blink: false } }
  if (mode === 'main') {
    const face = await new FontFace(family, `url(${JSON.stringify(fontUrl)})`).load()
    document.fonts.add(face)
    const terminal = await MainTerminal.create({
      appearance,
      runtime: { kind: 'owned', options: assets },
      rendererFactory: (options) => WebGlTerminalRenderer.create(options),
    })
    active.push(terminal)
    return terminal
  }
  const terminal = await WorkerTerminal.create({
    appearance,
    backend: mode,
    fonts: [{ family, source: { url: fontUrl } }],
  })
  active.push(terminal)
  return terminal
}

describe.each(['main', 'webgl', 'webgpu'] as const)('%s shared await-style terminal', (mode) => {
  it('runs real native output, fitted layout, input, reset and captures through the packaged entry', async () => {
    const terminal = await create(mode)
    const root = container()
    const events: string[] = []
    terminal.on('title', (title) => events.push(title))
    await terminal.open(root)
    const bytes = new TextEncoder().encode('packaged worker\r\n\x1b]2;ordered-title\x07')
    const result = terminal.write(bytes)
    expect(result instanceof Promise).toBe(mode !== 'main')
    bytes.fill(0)
    await result
    expect(bytes.buffer.byteLength).toBeGreaterThan(0)
    expect(events).toEqual(['ordered-title'])
    await eventually(() => terminal.visibleLines()[0]?.trimEnd() === 'packaged worker')
    const summary = terminal.submittedFrame!
    expect(Object.isFrozen(summary)).toBe(true)
    expect(Object.isFrozen(summary.grid)).toBe(true)
    expect(Object.isFrozen(summary.rows)).toBe(true)
    expect(summary.font.settings.family).toBe(family)
    expect(summary.grid.cellWidth).toBe(summary.font.cssCellWidth)
    expect(summary.grid.cellHeight).toBe(summary.font.cssCellHeight)
    expect(summary.grid.columns).toBeGreaterThan(1)
    await eventually(async () => (await terminal.frameSnapshot()) !== undefined)
    let capture: string | undefined
    await eventually(async () => {
      capture = await terminal.captureViewport()
      return capture !== undefined
    })
    expect(JSON.parse(capture!).version).toBe(1)
    expect((await terminal.readLines(0, 1))[0]?.text).toContain('packaged worker')
    expect(
      Array.from(
        await terminal.key({ action: 'press', code: 'KeyA', composing: false, text: 'a' }),
      ),
    ).toEqual([97])
    await terminal.write('\x1b[?2004h\x1b[?1004h')
    expect(new TextDecoder().decode(await terminal.paste('paste'))).toBe('\x1b[200~paste\x1b[201~')
    const output: string[] = []
    terminal.onData((data) => output.push(new TextDecoder().decode(data)))
    terminal.focus()
    await eventually(() => output.includes('\x1b[I'))
    terminal.blur()
    await eventually(() => output.includes('\x1b[O'))
    terminal.textarea!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true, cancelable: true }),
    )
    await eventually(() => output.includes('b'))
    terminal.textarea!.value = 'text input'
    terminal.textarea!.dispatchEvent(
      new InputEvent('input', { data: 'text input', inputType: 'insertText', bubbles: true }),
    )
    await eventually(() => output.includes('text input'))
    const oldLayout = terminal.submittedFrame!.layout
    root.style.width = '320px'
    await eventually(
      () =>
        terminal.submittedFrame!.layout > oldLayout &&
        terminal.submittedFrame!.grid.columns < summary.grid.columns,
    )
    await terminal.setFont({ size: 18 })
    await eventually(() => terminal.submittedFrame!.font.settings.size === 18)
    const fitted = terminal.submittedFrame!
    expect(fitted.grid.cellWidth).toBe(fitted.font.cssCellWidth)
    expect(fitted.grid.cellHeight).toBe(fitted.font.cssCellHeight)
    await page.screenshot({
      element: terminal.element!,
      path: `../../../.artifacts/packaged-worker-${mode}.png`,
      scale: 'css',
    })
    await terminal.reset()
    await eventually(() => terminal.visibleLines().every((line) => line.trim() === ''))
  }, 25_000)
})

it.each(['webgl', 'webgpu'] as const)(
  '%s settles authority while page animation frames are suspended',
  async (backend) => {
    const terminal = await create(backend)
    await terminal.open(container())
    const request = window.requestAnimationFrame
    window.requestAnimationFrame = () => 0
    try {
      await terminal.write('message-driven')
      expect((await terminal.readLines(0, 1))[0]?.text).toContain('message-driven')
      expect(await terminal.sendInput('x')).toEqual(new Uint8Array([120]))
      await terminal.setFont({ size: 20 })
      expect(terminal.appearance.font.size).toBe(20)
      const disposal = terminal.dispose()
      expect(terminal.lifecycle).toBe('disposed')
      expect(terminal.element).toBeUndefined()
      await disposal
    } finally {
      window.requestAnimationFrame = request
    }
  },
  20_000,
)

it('processes transferred producer output before an explicit control fence and actor disposal', async () => {
  const terminal = await WorkerTerminal.create({
    assets,
    backend: 'webgl',
    workerUrl,
    fonts: [{ family, source: { url: fontUrl } }],
  })
  active.push(terminal)
  await terminal.open(container())
  const channel = new MessageChannel()
  const ready = new Promise<TerminalOutputReady>((resolve) => {
    channel.port1.onmessage = ({ data }: MessageEvent<TerminalOutputReady>) => {
      if (data.type === 'ready') resolve(data)
    }
    channel.port1.start()
  })
  await terminal.attachOutputPort(channel.port2)
  const identity = await ready
  const buffer = new TextEncoder().encode('direct producer')
  const message: TerminalOutputMessage = { ...identity, type: 'output', sequence: 1, data: buffer }
  const fence = terminal.fenceOutput(1)
  const layout = terminal.setFont({ size: 18 })
  const read = terminal.readLines(0, 1)
  channel.port1.postMessage(message, [buffer.buffer])
  expect(buffer.byteLength).toBe(0)
  await fence
  await layout
  expect((await read)[0]?.text).toContain('direct producer')
  expect(terminal.appearance.font.size).toBe(18)
  const secondFence = terminal.fenceOutput(2)
  const rejection = expect(secondFence).rejects.toMatchObject({ code: 'disposed' })
  const disposal = terminal.dispose()
  await rejection
  const tail = new TextEncoder().encode(' disposal fence')
  channel.port1.postMessage({ ...identity, type: 'output', sequence: 2, data: tail }, [tail.buffer])
  await disposal
  channel.port1.close()
}, 20_000)

it('rejects pending authority at host disposal and awaits worker cleanup', async () => {
  const terminal = await WorkerTerminal.create({
    assets,
    backend: 'webgl',
    workerUrl,
    fonts: [{ family, source: { url: fontUrl } }],
  })
  active.push(terminal)
  await terminal.open(container())
  const pending = terminal.write('pending')
  const rejection = expect(pending).rejects.toMatchObject({ code: 'disposed' })
  const disposal = terminal.dispose()
  expect(terminal.lifecycle).toBe('disposed')
  await rejection
  await disposal
})

it('fails missing explicit fonts with a structured startup error', async () => {
  await expect(
    WorkerTerminal.create({ assets, backend: 'webgl', workerUrl, fonts: [] }),
  ).rejects.toBeInstanceOf(TerminalWorkerError)
})

it('fails an explicit unavailable worker backend without falling back to the page', async () => {
  const terminal = await WorkerTerminal.create({
    assets,
    backend: 'webgpu',
    fonts: [{ family, source: { url: fontUrl } }],
    workerUrl: new URL('./tests/capability.worker.ts', import.meta.url),
  })
  active.push(terminal)
  await expect(terminal.open(container())).rejects.toMatchObject({
    code: 'capability',
    operation: 'renderer.webgpu',
  })
  expect(terminal.lifecycle).toBe('disposed')
})

it.each(['generation', 'control'] as const)(
  'rejects a stale %s envelope in the real packaged actor',
  async (field) => {
    const worker = new Worker(workerUrl, { type: 'module' })
    const channel = new MessageChannel()
    const next = () =>
      new Promise<import('./protocol.js').WorkerMessage>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new DOMException('Actor reply timed out', 'TimeoutError')),
          5_000,
        )
        channel.port1.onmessage = ({ data }) => {
          clearTimeout(timeout)
          resolve(data)
        }
        channel.port1.onmessageerror = () => {
          clearTimeout(timeout)
          reject(new DOMException('Actor reply cannot be decoded', 'DataCloneError'))
        }
      })
    try {
      const startup = next()
      channel.port1.start()
      worker.postMessage(
        {
          type: 'initialize',
          terminal: 'protocol-test',
          generation: 1,
          port: channel.port2,
          assets,
          backend: 'webgl',
          faces: [{ family, source: { url: fontUrl } }],
          appearance: { font: { family } },
        },
        [channel.port2],
      )
      expect((await startup).type).toBe('reply')
      const fatal = next()
      channel.port1.postMessage({
        type: 'request',
        terminal: 'protocol-test',
        generation: field === 'generation' ? 0 : 1,
        id: 1,
        control: field === 'control' ? 2 : 1,
        output: 0,
        command: 'readLines',
        args: [0, 1],
      })
      expect(await fatal).toMatchObject({
        type: 'fatal',
        failure: { code: 'protocol', operation: 'request' },
      })
    } finally {
      worker.terminate()
      channel.port1.close()
      channel.port2.close()
    }
  },
)

it('invalidates the host after a producer sequence error', async () => {
  const terminal = await create('webgl')
  await terminal.open(container())
  const errors: unknown[] = []
  terminal.on('error', (error) => errors.push(error.cause))
  const channel = new MessageChannel()
  try {
    const ready = new Promise<TerminalOutputReady>((resolve) => {
      channel.port1.onmessage = ({ data }: MessageEvent<TerminalOutputReady>) => {
        if (data.type === 'ready') resolve(data)
      }
      channel.port1.start()
    })
    await terminal.attachOutputPort(channel.port2)
    const identity = await ready
    channel.port1.postMessage({
      ...identity,
      type: 'output',
      sequence: 2,
      data: new Uint8Array([120]),
    })
    await eventually(() => terminal.lifecycle === 'disposed')
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'protocol', operation: 'output' }),
    )
    await terminal.dispose()
  } finally {
    channel.port1.close()
  }
})

it('owns explicit font bytes and selects supported WebGL when auto has no WebGPU', async () => {
  const bytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer())
  const byteFamily = 'WorkerByteFont'
  const terminal = await WorkerTerminal.create({
    assets,
    fonts: [{ family: byteFamily, source: { bytes }, descriptors: { weight: '400' } }],
    workerUrl: new URL('./tests/capability.worker.ts', import.meta.url),
  })
  active.push(terminal)
  expect(bytes.byteLength).toBeGreaterThan(0)
  bytes.fill(0)
  await terminal.open(container())
  await terminal.write('owned font bytes')
  await eventually(() => terminal.visibleLines()[0]?.trimEnd() === 'owned font bytes')
  expect(terminal.diagnostics.rendererBackend).toBe('webgl2')
  expect(terminal.submittedFrame?.font.settings.family).toBe(byteFamily)
  expect(Array.from(document.fonts).some((face) => face.family === byteFamily)).toBe(false)
})

it('forwards release after a pending press when host input becomes disabled', async () => {
  let disabled = false
  const terminal = await WorkerTerminal.create({
    backend: 'webgl',
    fonts: [{ family, source: { url: fontUrl } }],
    inputHooks: { inputDisabled: () => disabled },
  })
  active.push(terminal)
  await terminal.open(container())
  await terminal.write('\x1b[>11u')
  const output: string[] = []
  terminal.onData((data) => output.push(new TextDecoder().decode(data)))
  terminal.textarea!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }),
  )
  disabled = true
  terminal.textarea!.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }),
  )
  await terminal.readLines(0, 1)
  expect(output).toEqual(['\x1b[97u', '\x1b[97;1:3u'])
})
