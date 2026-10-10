import { afterEach, assert, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import { VirtualizedTextView } from '../src/virtualization'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofHighlightPaintScreenshot: (hostId: string) => Promise<string>
  }
}

const mounted: { host: HTMLElement; view: VirtualizedTextView }[] = []
afterEach(() => {
  for (const { host, view } of mounted.splice(0)) {
    view.dispose()
    host.remove()
  }
})

it('keeps syntax red beneath a colorless wash in every engine', async () => {
  const { host, view } = mount()
  const control = await pixels(host.id)
  expect(redInk(control)).toBeGreaterThan(20)
  view.setRangeHighlight('paint-wash', [{ start: 0, end: 12 }], { backgroundColor: '#333333' })
  const painted = await pixels(host.id)
  expect(redInk(painted)).toBeGreaterThan(20)
})

it('fades each token in its own hue', async () => {
  const { host, view } = mount()
  view.setRangeHighlight('fade', [{ start: 0, end: 12 }], { overlay: { dim: 0.5 } })
  const painted = await pixels(host.id)
  expect(redInk(painted)).toBe(0)
  expect(
    ink(painted, (red, green, blue) => red > 70 && red < 150 && green < 20 && blue < 20),
  ).toBeGreaterThan(20)
})

it('keeps a plain-text overlay range after an atomic text update', async () => {
  const { host, view } = mount()
  view.setTokens([])
  view.setRangeHighlight('spelling', [{ start: 4, end: 9 }], {
    overlay: { textDecoration: 'underline wavy blue' },
  })
  await pixels(host.id)
  view.runAtomicRender(() => {
    view.setText('NMMMMMMMMMMM')
    view.setRangeHighlight('spelling', [{ start: 4, end: 9 }], {
      overlay: { textDecoration: 'underline wavy blue' },
    })
  })
  await pixels(host.id)
  const ranges = [...CSS.highlights]
    .filter(([name]) => name.includes('-overlay-base-'))
    .flatMap(([, highlight]) =>
      Array.from(highlight, (range) => [range.startOffset, range.endOffset]),
    )
  expect(ranges).toEqual([[4, 9]])
})

it('strikes syntax with a line in the same explicit hue', async () => {
  const { host, view } = mount()
  const control = await pixels(host.id)
  view.setRangeHighlight('strike', [{ start: 0, end: 12 }], {
    overlay: { textDecoration: 'line-through' },
  })
  const painted = await pixels(host.id)
  expect(redInk(painted)).toBeGreaterThan(redInk(control) + 20)
  expect(ink(painted, (red, green, blue) => red > 180 && green > 180 && blue > 180)).toBe(0)
})

it('fades untokenized foreground and preserves higher-priority colors', async () => {
  const { host, view } = mount()
  view.setTokens([])
  view.setRangeHighlight('fade', [{ start: 0, end: 12 }], { overlay: { dim: 0.5 } })
  const base = await pixels(host.id)
  expect(
    ink(
      base,
      (red, green, blue) =>
        red > 70 && red < 150 && Math.abs(red - green) < 3 && Math.abs(red - blue) < 3,
    ),
  ).toBeGreaterThan(20)
  view.setTokens([{ start: 0, end: 12, style: { color: '#ff0000' } }])
  view.setRangeHighlight('semantic', [{ start: 0, end: 12 }], { color: '#00ff00', zIndex: 2 })
  const semantic = await pixels(host.id)
  expect(redInk(semantic)).toBe(0)
  expect(
    ink(semantic, (red, green, blue) => red < 20 && green > 70 && green < 150 && blue < 20),
  ).toBeGreaterThan(20)
  view.setRangeHighlight('find', [{ start: 0, end: 12 }], {
    color: '#0000ff',
    zIndex: 6,
    dimmable: false,
  })
  expect(
    ink(await pixels(host.id), (red, green, blue) => red < 20 && green < 20 && blue > 180),
  ).toBeGreaterThan(20)
})

function mount() {
  const host = document.createElement('div')
  host.id = `paint-${mounted.length}`
  host.style.cssText = 'width:480px;height:80px;background:black;color:white;font:24px monospace'
  host.style.setProperty('--editor-background', '#000000')
  host.style.setProperty('--editor-foreground', '#ffffff')
  document.body.append(host)
  const view = new VirtualizedTextView(host, { rowHeight: 32, overscan: 0 })
  view.setText('MMMMMMMMMMMM')
  view.setScrollMetrics(0, 80, 480)
  view.setTokens([{ start: 0, end: 12, style: { color: '#ff0000' } }])
  mounted.push({ host, view })
  return { host, view }
}

async function pixels(hostId: string): Promise<ImageData> {
  const screenshot = await commands.proofHighlightPaintScreenshot(hostId)
  const bytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  assert(context)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function redInk({ data }: ImageData): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (data[index]! > 150 && data[index + 1]! < 100 && data[index + 2]! < 100) count++
  }
  return count
}

function ink(
  { data }: ImageData,
  matches: (red: number, green: number, blue: number) => boolean,
): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (matches(data[index]!, data[index + 1]!, data[index + 2]!)) count++
  }
  return count
}

it('keeps an equal-priority range color above twins after a token refresh', async () => {
  const { host, view } = mount()
  view.setRangeHighlight('color', [{ start: 0, end: 12 }], { color: '#00ff00' })
  view.setRangeHighlight('fade', [{ start: 0, end: 6 }], { overlay: { dim: 0.5 } })
  view.setTokens([{ start: 0, end: 12, style: { color: '#ff0000' } }])
  const painted = await pixels(host.id)
  expect(redInk(painted)).toBe(0)
  expect(ink(painted, (red, green, blue) => red < 20 && green > 70 && blue < 20)).toBeGreaterThan(
    20,
  )
})

it('refreshes only the revealed editor ranges and preserves shared syntax groups', () => {
  const peer = mount()
  const host = document.createElement('div')
  host.style.cssText = 'width:480px;height:80px;visibility:hidden'
  document.body.append(host)
  const editor = new Editor(host, { presentationReady: false })
  try {
    editor.setText('MMMMMMMMMMMM')
    editor.setTokens([{ start: 0, end: 12, style: { color: '#ff0000' } }])
    const entry = [...CSS.highlights].find(([, group]) =>
      [...group].some((range) => host.contains(range.startContainer)),
    )!
    expect(entry).toBeDefined()
    const [name, group] = entry
    const ranges = [...group]
    const owned = ranges.filter((range) => host.contains(range.startContainer))
    const peerRanges = ranges.filter((range) => peer.host.contains(range.startContainer))
    expect(owned.length).toBeGreaterThan(0)
    expect(peerRanges.length).toBeGreaterThan(0)
    const removed = vi.spyOn(group, 'delete')
    host.style.visibility = 'visible'
    editor.setPresentationReady(true)
    expect(removed.mock.calls.map(([range]) => range)).toEqual(
      CSS.supports('-webkit-nbsp-mode', 'space') ? owned : [],
    )
    expect(CSS.highlights.get(name)).toBe(group)
    expect(new Set(group)).toEqual(new Set(ranges))
    removed.mockClear()
    editor.setPresentationReady(true)
    expect(removed).not.toHaveBeenCalled()
    editor.setPresentationReady(false)
    editor.setPresentationReady(true)
    expect(removed.mock.calls.map(([range]) => range)).toEqual(
      CSS.supports('-webkit-nbsp-mode', 'space') ? owned : [],
    )
    editor.dispose()
    expect([...group]).toEqual(peerRanges)
    removed.mockClear()
    editor.setPresentationReady(false)
    editor.setPresentationReady(true)
    expect(removed).not.toHaveBeenCalled()
    removed.mockRestore()
  } finally {
    editor.dispose()
    host.remove()
  }
})

it('limits native presentation invalidation to the engine capability that needs it', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:1280px;height:600px;visibility:hidden'
  document.body.append(host)
  const editor = new Editor(host, { presentationReady: false, lineHeight: 18 })
  try {
    editor.setText(('x '.repeat(100) + '\n').repeat(50_000))
    const styles = [{ color: '#ff0000' }, { color: '#0000ff' }]
    editor.setTokens(
      Array.from({ length: 40_000 }, (_, index) => {
        const start = Math.floor(index / 100) * 201 + (index % 100) * 2
        return { start, end: start + 1, style: styles[index % 2]! }
      }),
    )
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const entries = [...CSS.highlights].filter(([, group]) =>
      [...group].some((range) => host.contains(range.startContainer)),
    )
    const count = entries.reduce(
      (sum, [, group]) =>
        sum + [...group].filter((range) => host.contains(range.startContainer)).length,
      0,
    )
    expect(count).toBeGreaterThan(1_000)
    host.style.visibility = 'visible'
    const samples: number[] = []
    for (let index = 0; index < 10; index++) {
      editor.setPresentationReady(false)
      const start = performance.now()
      editor.setPresentationReady(true)
      samples.push(performance.now() - start)
    }
    console.info(
      'presentation membership cost',
      JSON.stringify({
        count,
        samples,
        nativeCapability: CSS.supports('-webkit-nbsp-mode', 'space'),
        touchCallout: CSS.supports('-webkit-touch-callout', 'none'),
        nbspMode: CSS.supports('-webkit-nbsp-mode', 'space'),
      }),
    )
    const removed = entries.map(([, group]) => vi.spyOn(group, 'delete'))
    try {
      editor.setPresentationReady(false)
      editor.setPresentationReady(true)
      expect(removed.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(
        CSS.supports('-webkit-nbsp-mode', 'space') ? count : 0,
      )
    } finally {
      for (const spy of removed) spy.mockRestore()
    }
  } finally {
    editor.dispose()
    host.remove()
  }
})
