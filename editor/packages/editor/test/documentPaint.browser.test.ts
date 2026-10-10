import { afterEach, beforeAll, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { Editor } from '../src/editor/Editor'
import { decodePaintSnapshot, mountPaintSnapshot } from '../src/paint'
import { createLineGutterPlugin } from '../../gutters/src/lineGutter'
import { markdownInlineReplacements } from '../../markdown/src/replacements'
import {
  headingContribution,
  markdownHeadings,
  type MarkdownHeadings,
} from '../../markdown/src/headings'
import type { EditorPlugin } from '../src/plugins'
import { createTreeSitterLanguagePlugin } from '../../tree-sitter/src/index'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import '../src/style.css'
import '../../gutters/src/lineGutter.css'
import '../../markdown/src/style.css'

import largestManual from '../../../site/src/content/docs/docs/guides/frameworks.md?raw'
import manual from '../../../site/src/content/docs/docs/start-here/quick-start.md?raw'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofDocumentPaintScreenshot(label: string): Promise<string>
    proofDocumentPaintResult(result: Record<string, unknown>, payload: string): Promise<void>
    proofDocumentPaintThrottle(rate: number): Promise<boolean>
    proofDocumentPaintCold(
      payload: string,
      entry: string,
      fonts: readonly (readonly [string, string])[],
      width: number,
    ): Promise<{
      readonly image: string
      readonly requests: readonly string[]
      readonly fontWaitMs: number
      readonly importMs: number
      readonly decodeMs: number
      readonly mountMs: number
      readonly layoutMs: number
      readonly frameOpportunityMs: number
      readonly rowCount: number
      readonly height: number
    }>
  }
}

const monoUrl = new URL('./fixtures/fonts/jetbrains-mono.woff2', import.meta.url).href
const serifUrl = new URL('./fixtures/fonts/source-serif-4.woff2', import.meta.url).href
const sansUrl = new URL('./fixtures/freefont/FreeSans.ttf', import.meta.url).href
const mounted: { editor?: Editor; host: HTMLElement; dispose?: () => void }[] = []

beforeAll(async () => {
  const mask = document.createElement('style')
  mask.textContent = '.editor-virtualized-caret { visibility: hidden !important; }'
  document.head.append(mask)
  await init()
  for (const [family, url] of [
    ['Snapshot Mono', monoUrl],
    ['Snapshot Serif', serifUrl],
    ['Snapshot Sans', sansUrl],
  ]) {
    const face = new FontFace(family!, `url(${url})`)
    document.fonts.add(await face.load())
  }
  await document.fonts.ready
})

afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.editor?.dispose()
    item.dispose?.()
    item.host.remove()
  }
})

function mount(text: string, markdown: boolean, family: string, dark: boolean) {
  const host = document.createElement('div')
  host.id = 'document-paint-proof'
  host.style.cssText = 'position:relative;width:1280px'
  document.body.append(host)
  const parser = markdown ? new MarkdownDocument() : null
  parser?.setText(text)
  let headings: MarkdownHeadings | null = null
  const plugin: EditorPlugin = {
    name: 'snapshot-headings',
    activate(context) {
      return context.registerViewContribution({
        createContribution: (view) => headingContribution(view, () => headings),
      })
    },
  }
  const options = {
    scrollMode: 'content' as const,
    wordWrap: true,
    wordWrapBreak: 'word' as const,
    fontFamily: family,
    fontSize: 14,
    lineHeight: 22,
    tabSize: 4,
    gutterScroll: 'content' as const,
    plugins: [createLineGutterPlugin(), plugin],
    cursorLineHighlight: { rowBackground: false, gutterNumber: false, gutterBackground: false },
    theme: {
      type: dark ? ('dark' as const) : ('light' as const),
      foregroundColor: dark ? '#dddddd' : '#222222',
      backgroundColor: dark ? '#202020' : '#ffffff',
      gutterForegroundColor: dark ? '#aaaaaa' : '#555555',
      gutterBackgroundColor: dark ? '#202020' : '#ffffff',
    },
  }
  const editor = new Editor(host, options)
  const item = { host, editor, dispose: () => parser?.dispose() }
  mounted.push(item)
  editor.setText(text)
  editor.setSelection(text.length)
  const installPreview = (target: Editor) => {
    if (!parser) return
    target.setInlineReplacementProvider(
      (context) => {
        const records = parser.decorations(0, text.length)
        const replacements = markdownInlineReplacements(context.textSnapshot, records)
        headings = markdownHeadings(
          { ...context, records: { languageId: 'markdown', data: records } },
          replacements,
        )
        return replacements
      },
      { trigger: 'edit' },
    )
  }
  if (parser) installPreview(editor)
  else editor.setTokens([{ start: 0, end: 5, style: { color: '#cc3311' } }])
  return { host, editor, options, item, installPreview }
}

async function frames() {
  await document.fonts.ready
  for (let index = 0; index < 3; index++) await new Promise(requestAnimationFrame)
  await document.fonts.ready
}

async function pixels(label: string): Promise<ImageData> {
  return imagePixels(await commands.proofDocumentPaintScreenshot(label))
}

async function imagePixels(screenshot: string): Promise<ImageData> {
  const bytes = Uint8Array.from(atob(screenshot), (character) => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function changedPixels(before: ImageData, after: ImageData): number {
  expect(after.width).toBe(before.width)
  expect(after.height).toBe(before.height)
  let changed = 0
  for (let index = 0; index < before.data.length; index += 4) {
    if (
      before.data[index] !== after.data[index] ||
      before.data[index + 1] !== after.data[index + 1] ||
      before.data[index + 2] !== after.data[index + 2] ||
      before.data[index + 3] !== after.data[index + 3]
    )
      changed++
  }
  return changed
}

const code =
  'const value = "a long string with words and averylongidentifier";\n// spaces   tabs\tCJK 中文 combining é emoji 😀\nlast'

it.each([false, true])(
  'reflows one captured code document with zero changed pixels, dark=%s',
  async (dark) => {
    const { host, editor, options, item } = mount(code, false, 'Snapshot Mono', dark)
    await frames()
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    for (const width of [320, 390, 1280]) {
      host.style.width = `${width}px`
      await frames()
      const height = editor.getContentHeight()
      const label = `code-${dark}-${width}`
      const live = await pixels(`${label}-live`)
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0'
      host.append(overlay)
      const paint = decodePaintSnapshot(saved.paint)!
      const restored = mountPaintSnapshot(overlay, paint, { width })!
      expect(restored).not.toBeNull()
      expect(restored.height).toBe(height)
      const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
      scroller.style.visibility = 'hidden'
      const staticPaint = await pixels(`${label}-static`)
      expect(changedPixels(live, staticPaint), label).toBe(0)
      restored.dispose()
      overlay.remove()
      scroller.style.visibility = ''
      await benchmark(saved.paint, width, { fixture: 'code', dark, height })
    }
    const originalPixels = await pixels(`code-${dark}-before-takeover`)
    editor.dispose()
    const restoredEditor = new Editor(host, {
      ...options,
      snapshot: saved.paint,
      documentKey: 'code',
    })
    item.editor = restoredEditor
    expect(restoredEditor.getPresentationState()).toBe('provisional')
    expect(host.querySelector('a')).toBeNull()
    const provisionalPixels = await pixels(`code-${dark}-provisional`)
    expect(changedPixels(originalPixels, provisionalPixels)).toBe(0)
    restoredEditor.setText(code)
    restoredEditor.setTokens([{ start: 0, end: 5, style: { color: '#cc3311' } }])
    await frames()
    expect(restoredEditor.getPresentationState()).toBe('live')
    const livePixels = await pixels(`code-${dark}-takeover`)
    expect(changedPixels(provisionalPixels, livePixels)).toBe(0)
  },
)

it.each([
  ['Snapshot Mono', false],
  ['Snapshot Mono', true],
  ['Snapshot Serif', false],
  ['Snapshot Serif', true],
  ['Snapshot Sans', false],
  ['Snapshot Sans', true],
] as const)(
  'captures real Markdown preview and preserves its links, headings and text in %s, dark=%s',
  async (family, dark) => {
    const text =
      '# Heading\n**bold** *italic* ~~strike~~ `inline code`\nread [the long label with words and averylongidentifier](https://example.com) now\n\n' +
      manual +
      '\nlast'
    const fixture = mount(text, true, family, dark)
    const { host, options, item, installPreview } = fixture
    let editor = fixture.editor
    await frames()
    expect(editor.captureSnapshot()).toBeNull()
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const paint = decodePaintSnapshot(saved.paint)!
    for (const width of [320, 390, 1280]) {
      host.style.width = `${width}px`
      await frames()
      const liveText = [...host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
        .sort((a, b) => Number(a.dataset.editorVirtualRow) - Number(b.dataset.editorVirtualRow))
        .map((row) => row.textContent)
        .join('')
      const live = await pixels(`markdown-${family}-${dark}-${width}-live`)
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0'
      host.append(overlay)
      const restored = mountPaintSnapshot(overlay, paint, { width })!
      expect(restored).not.toBeNull()
      expect(restored.height).toBe(editor.getContentHeight())
      expect(
        [...restored.element.querySelectorAll('[data-editor-document-paint-row]')]
          .map((row) => row.textContent)
          .join(''),
      ).toBe(liveText)
      expect(restored.element.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
      expect(restored.element.querySelector('[role=heading]')?.getAttribute('aria-label')).toBe(
        'Heading',
      )
      expect(restored.element.querySelector('[role=heading]')?.id).toBe('heading')
      const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
      scroller.style.visibility = 'hidden'
      const staticPaint = await pixels(`markdown-${family}-${dark}-${width}-static`)
      expect(changedPixels(live, staticPaint)).toBe(0)
      const markup = restored.element.outerHTML
      restored.dispose()
      const inert = new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild!
      overlay.append(inert)
      const htmlPaint = await pixels(`markdown-${family}-${dark}-${width}-html`)
      expect(changedPixels(live, htmlPaint)).toBe(0)
      expect(inert.querySelector('script, iframe, style, img')).toBeNull()
      overlay.remove()
      scroller.style.visibility = ''
      await benchmark(saved.paint, width, { fixture: 'manual', family, dark })
      editor.dispose()
      editor = new Editor(host, { ...options, snapshot: saved.paint })
      item.editor = editor
      expect(editor.getPresentationState()).toBe('provisional')
      expect(
        changedPixels(live, await pixels(`markdown-${family}-${dark}-${width}-provisional`)),
      ).toBe(0)
      editor.setText(text)
      editor.setSelection(text.length)
      installPreview(editor)
      await frames()
      expect(editor.getPresentationState()).toBe('live')
      expect(
        changedPixels(live, await pixels(`markdown-${family}-${dark}-${width}-takeover`)),
      ).toBe(0)
      host.style.display = 'none'
      await frames()
      host.style.display = ''
      await frames()
      expect(
        changedPixels(live, await pixels(`markdown-${family}-${dark}-${width}-revealed`)),
      ).toBe(0)
    }
  },
)

it('captures and mounts every row in a document above 400 rows', async () => {
  const text = Array.from({ length: 450 }, (_, index) => `line ${index} alpha beta gamma`).join(
    '\n',
  )
  const { host, editor } = mount(text, false, 'Snapshot Mono', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const target = document.createElement('div')
  host.append(target)
  const restored = mountPaintSnapshot(target, decodePaintSnapshot(saved.paint)!, { width: 320 })!
  expect(restored.rowCount).toBeGreaterThanOrEqual(450)
  expect(restored.element.textContent).toContain('line 449 alpha beta gamma')
  expect(editor.captureSnapshot()).toBeNull()
  restored.dispose()
  target.remove()
  for (const width of [320, 390, 1280]) await benchmark(saved.paint, width, { fixture: '450-rows' })
})

it('refuses unsupported plugins and unsafe links without truncating the capture', async () => {
  const { editor } = mount('abc\nlast', false, 'Snapshot Mono', false)
  editor.setInlineReplacementProvider(() => [
    {
      id: 'widget',
      startIndex: 0,
      endIndex: 3,
      text: 'abc',
      kind: 'foreign',
      render(container) {
        container.innerHTML = '<img src="data:,">'
      },
    },
  ])
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'unsupported' })
  editor.setInlineReplacementProvider(() => [
    {
      id: 'unsafe',
      startIndex: 0,
      endIndex: 3,
      text: 'abc',
      kind: 'link',
      className: 'editor-markdown-text',
      render(container) {
        const anchor = document.createElement('a')
        anchor.className = 'editor-markdown-link'
        anchor.textContent = 'abc'
        anchor.href = 'javascript:alert(1)'
        container.append(anchor)
      },
    },
  ])
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'unsupported' })
})

async function benchmark(payload: string, width: number, fixture: Record<string, unknown>) {
  const samples: number[] = []
  const decode: number[] = []
  const mount: number[] = []
  const layout: number[] = []
  let htmlBytes = 0
  let rowCount = 0
  const longTasks: { readonly start: number; readonly duration: number }[] = []
  const observerAvailable = PerformanceObserver.supportedEntryTypes.includes('longtask')
  const observer = observerAvailable
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          longTasks.push({ start: entry.startTime, duration: entry.duration })
      })
    : null
  observer?.observe({ type: 'longtask' })
  const target = document.createElement('div')
  target.style.cssText = 'position:absolute;left:0;top:0'
  document.body.append(target)
  for (let iteration = 0; iteration < 30; iteration++) {
    // Each restore gets its own task; the 30 samples must not form one artificial long task.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const start = performance.now()
    const paint = decodePaintSnapshot(payload)!
    const decoded = performance.now()
    const mounted = mountPaintSnapshot(target, paint, { width })!
    const inserted = performance.now()
    mounted.element.getBoundingClientRect()
    const laidOut = performance.now()
    decode.push(decoded - start)
    mount.push(inserted - decoded)
    layout.push(laidOut - inserted)
    samples.push(laidOut - start)
    if (iteration === 29) {
      htmlBytes = new TextEncoder().encode(mounted.element.outerHTML).length
      rowCount = mounted.rowCount
    }
    mounted.dispose()
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  for (const entry of observer?.takeRecords() ?? [])
    longTasks.push({ start: entry.startTime, duration: entry.duration })
  observer?.disconnect()
  target.remove()
  const sorted = samples.toSorted((a, b) => a - b)
  await commands.proofDocumentPaintResult(
    {
      ...fixture,
      width,
      dpr: devicePixelRatio,
      samples,
      decode,
      mount,
      layout,
      p95: sorted[28],
      htmlBytes,
      rowCount,
      budgetMs: 50,
      p95WithinBudget: sorted[28]! <= 50,
      maximumMs: sorted.at(-1),
      maximumWithinBudget: sorted.at(-1)! <= 50,
      longTaskObserverAvailable: observerAvailable,
      longTasks,
      experiment: true,
    },
    payload,
  )
}

it('measures the largest checked-in manual at every required width', async () => {
  const { editor } = mount(largestManual + '\nlast', true, 'Snapshot Serif', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  for (const width of [320, 390, 1280])
    await benchmark(saved.paint, width, { fixture: 'largest-manual' })
})

it('admits equivalent font serialization and refuses different fonts and palettes', async () => {
  const { editor, options } = mount(code, false, 'Snapshot Mono', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  for (const [fontFamily, dark, admitted] of [
    ['"Snapshot Mono"', false, true],
    ['Snapshot Serif', false, false],
    ['Snapshot Mono', true, false],
  ] as const) {
    const host = document.createElement('div')
    host.style.width = '390px'
    document.body.append(host)
    const restored = new Editor(host, {
      ...options,
      fontFamily,
      theme: {
        ...options.theme,
        backgroundColor: dark ? '#202020' : 'rgb(255, 255, 255)',
        foregroundColor: 'rgb(34, 34, 34)',
      },
      snapshot: saved.paint,
      documentKey: 'font-admission',
    })
    mounted.push({ host, editor: restored })
    expect(restored.getPresentationState()).toBe(admitted ? 'provisional' : 'empty')
  }
})

it('records Chromium CPU slowdown as a restore experiment', async () => {
  const chromium = await commands.proofDocumentPaintThrottle(1)
  if (!chromium) return
  const { editor } = mount(largestManual + '\nlast', true, 'Snapshot Serif', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  try {
    await commands.proofDocumentPaintThrottle(4)
    for (const width of [320, 390, 1280])
      await benchmark(saved.paint, width, {
        fixture: 'largest-manual',
        cpuSlowdown: 4,
        experiment: true,
      })
  } finally {
    await commands.proofDocumentPaintThrottle(1)
  }
})

it('restores and resizes padded content at its live height and pixels', async () => {
  const text = 'alpha beta gamma delta epsilon zeta '.repeat(8)
  const { host, editor, options, item } = mount(text, false, 'Snapshot Mono', false)
  const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
  scroller.style.padding = '0 16px'
  const samples = []
  for (const width of [320, 390, 1280]) {
    host.style.width = `${width}px`
    await frames()
    samples.push({
      width,
      height: editor.getContentHeight(),
      pixels: await pixels(`padded-${width}-live`),
    })
  }
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  editor.dispose()
  const style = document.createElement('style')
  style.textContent = '#document-paint-proof .editor-virtualized { padding: 0 16px; }'
  host.append(style)
  const next = new Editor(host, { ...options, snapshot: saved.paint, documentKey: 'padding' })
  item.editor = next
  expect(next.getPresentationState()).toBe('provisional')
  for (const sample of samples) {
    host.style.width = `${sample.width}px`
    await frames()
    expect(next.getContentHeight()).toBe(sample.height)
    expect(changedPixels(sample.pixels, await pixels(`padded-${sample.width}-static`))).toBe(0)
  }
})
it('preserves active-line gutter backgrounds in static paint', async () => {
  const { host, editor, options, item } = mount('alpha\nbeta\nlast', false, 'Snapshot Mono', false)
  editor.dispose()
  const next = new Editor(host, {
    ...options,
    cursorLineHighlight: { rowBackground: false, gutterNumber: false, gutterBackground: true },
  })
  item.editor = next
  next.setText('alpha\nbeta\nlast')
  next.setSelection(0)
  host
    .querySelector<HTMLElement>('.editor-virtualized')!
    .style.setProperty('--editor-cursor-line-gutter-background', '#ff0000')
  next.focus()
  await frames()
  const saved = next.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const live = await pixels('active-gutter-live')
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0'
  host.append(overlay)
  const restored = mountPaintSnapshot(overlay, decodePaintSnapshot(saved.paint)!, { width: 1280 })!
  expect(restored).not.toBeNull()
  host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = 'hidden'
  const after = await pixels('active-gutter-static')
  expect(changedPixels(live, after)).toBe(0)
})

it('waits for an unloaded document font before the first standalone paint', async () => {
  const { host, editor } = mount(code, false, 'Snapshot Mono', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const decoded = decodePaintSnapshot(saved.paint)!
  if (decoded.format !== 6) return
  const fontFamily = 'Snapshot Cold'
  const style = { ...decoded.style, fontFamily }
  const paint = {
    ...decoded,
    style,
    rows: decoded.rows.map((row) => ({
      ...row,
      style: { ...row.style, fontFamily },
      runs: row.runs.map((run) => ({ ...run, style: { ...run.style, fontFamily } })),
    })),
  }
  const face = new FontFace(fontFamily, `url(${monoUrl})`)
  document.fonts.add(face)
  const target = document.createElement('div')
  host.append(target)
  try {
    expect(face.status).toBe('unloaded')
    expect(document.fonts.status).toBe('loaded')
    expect(mountPaintSnapshot(target, paint, { width: 390 })).toBeNull()
    expect(target.childElementCount).toBe(0)
    await face.load()
    await document.fonts.ready
    const restored = mountPaintSnapshot(target, paint, { width: 390 })!
    expect(restored).not.toBeNull()
    expect(restored.element.textContent).toContain('const value')
    restored.dispose()
  } finally {
    document.fonts.delete(face)
    target.remove()
  }
})

it('paints in a cold standalone context without editor, parser or worker requests', async () => {
  const { host, editor } = mount(code, false, 'Snapshot Mono', false)
  host.style.width = '390px'
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const live = await pixels('cold-entry-live')
  const result = await commands.proofDocumentPaintCold(
    saved.paint,
    new URL('../src/paint.ts', import.meta.url).href,
    [
      ['Snapshot Mono', monoUrl],
      ['Snapshot Serif', serifUrl],
    ],
    390,
  )
  expect(result.height).toBe(editor.getContentHeight())
  expect(
    result.requests.filter((path) =>
      /(?:Editor\.ts|documentSession|worker|tree-sitter|shiki|\.wasm)/i.test(path),
    ),
  ).toEqual([])
  expect(changedPixels(live, await imagePixels(result.image))).toBe(0)
  const { image: _, ...timings } = result
  await commands.proofDocumentPaintResult(
    {
      fixture: 'cold-paint-entry',
      ...timings,
      width: 390,
      dpr: devicePixelRatio,
      experiment: true,
    },
    saved.paint,
  )
})

it.each([
  ['Snapshot Serif', false],
  ['Snapshot Serif', true],
  ['Snapshot Sans', false],
  ['Snapshot Sans', true],
] as const)(
  'matches shaped proportional runs and native tabs in %s, dark=%s',
  async (family, dark) => {
    const text =
      'const ' + 'office ffi AV To WA iiii\t'.repeat(16) + '\n' + 'iiii\t'.repeat(24) + '\nlast'
    const { host, editor } = mount(text, false, family, dark)
    await frames()
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    for (const width of [320, 390, 1280]) {
      host.style.width = `${width}px`
      await frames()
      const live = await pixels(`shaped-${family}-${dark}-${width}-live`)
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0'
      host.append(overlay)
      const restored = mountPaintSnapshot(overlay, decodePaintSnapshot(saved.paint)!, { width })!
      expect(restored.height).toBe(editor.getContentHeight())
      host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = 'hidden'
      expect(changedPixels(live, await pixels(`shaped-${family}-${dark}-${width}-static`))).toBe(0)
      restored.dispose()
      overlay.remove()
      host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = ''
    }
  },
)

it.each([
  ['transform', 'translateX(4px)'],
  ['backgroundImage', 'linear-gradient(red, blue)'],
  ['opacity', '0.5'],
  ['textShadow', '1px 1px red'],
] as const)(
  'refuses supported-looking fragments with unrepresented %s paint',
  async (property, value) => {
    const { editor } = mount('abc\nlast', false, 'Snapshot Mono', false)
    editor.setInlineReplacementProvider(() => [
      {
        id: 'styled-fragment',
        startIndex: 0,
        endIndex: 3,
        text: 'abc',
        kind: 'link',
        className: 'editor-markdown-text',
        render(container) {
          container.style[property] = value
          const text = document.createElement('span')
          text.textContent = 'abc'
          container.append(text)
        },
      },
    ])
    await frames()
    expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'unsupported' })
  },
)

it('captures expanded fold candidates and refuses collapsed document paint', async () => {
  const text = 'root\n  child\nlast'
  const { editor } = mount(text, false, 'Snapshot Mono', false)
  editor.setSyntaxFolds([{ startLine: 0, endLine: 1, startIndex: 0, endIndex: 12, type: 'block' }])
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'ready' })
  expect(editor.fold(0)).toBe(true)
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'unsupported' })
  expect(editor.unfold(0)).toBe(true)
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({ status: 'ready' })
})

it('refuses noncollapsed selection highlights without dropping their paint', async () => {
  const { editor } = mount('alpha beta\nlast', false, 'Snapshot Mono', false)
  editor.focus()
  editor.setSelection(0, 5)
  await frames()
  expect(editor.captureSnapshot({ scope: 'document' })).toMatchObject({
    status: 'unsupported',
    reason: 'unsafe-or-unsupported-fragment',
  })
})

it.each([false, true])(
  'captures real TypeScript language-plugin colours with the default theme, dark=%s',
  async (dark) => {
    const text = 'export const answer: number = 42;\nconst message = "hello";\n// comment\nlast'
    const { host, editor: initial, options, item } = mount(text, false, 'Snapshot Mono', dark)
    initial.dispose()
    const editor = new Editor(host, {
      ...options,
      theme: { type: dark ? 'dark' : 'light' },
      plugins: [
        createLineGutterPlugin(),
        createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS),
      ],
    })
    item.editor = editor
    editor.setText(text, { languageId: 'typescript' })
    editor.setSelection(text.length)
    await frames()
    await expect.poll(() => editor.getState().syntaxStatus, { timeout: 20_000 }).toBe('ready')
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const paint = decodePaintSnapshot(saved.paint)!
    expect(paint.format).toBe(6)
    if (paint.format !== 6) return
    const runs = paint.rows.flatMap((row) => row.runs)
    expect(runs.some((run) => run.style.color !== paint.style.color)).toBe(true)
    for (const run of runs) {
      expect(run.style.color).not.toContain('var(')
      expect(run.style.backgroundColor).not.toContain('var(')
    }
    for (const width of [320, 390, 1280]) {
      host.style.width = `${width}px`
      await frames()
      const live = await pixels(`typescript-theme-${dark}-${width}-live`)
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0'
      host.append(overlay)
      const restored = mountPaintSnapshot(overlay, paint, { width })!
      expect(restored).not.toBeNull()
      expect(restored.height).toBe(editor.getContentHeight())
      host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = 'hidden'
      expect(changedPixels(live, await pixels(`typescript-theme-${dark}-${width}-static`))).toBe(0)
      restored.dispose()
      overlay.remove()
      host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = ''
    }
  },
)

it('resolves token foreground, background, fallbacks and currentColor in their CSS context', async () => {
  const { host, editor } = mount('alpha beta gamma\nlast', false, 'Snapshot Mono', false)
  host.style.setProperty('--snapshot-token', 'rgb(12, 34, 56)')
  host.style.setProperty('--snapshot-background', 'rgb(78, 90, 12)')
  editor.setTokens([
    {
      start: 0,
      end: 5,
      style: { color: 'var(--snapshot-token)', backgroundColor: 'var(--snapshot-background)' },
    },
    {
      start: 6,
      end: 10,
      style: { color: 'var(--missing-token, rgb(23, 45, 67))', backgroundColor: 'currentColor' },
    },
  ])
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const paint = decodePaintSnapshot(saved.paint)!
  if (paint.format !== 6) return
  expect(paint.rows[0]!.runs[0]!.style).toMatchObject({
    color: 'rgb(12, 34, 56)',
    backgroundColor: 'rgb(78, 90, 12)',
  })
  expect(paint.rows[0]!.runs.find((run) => run.text === 'beta')!.style).toMatchObject({
    color: 'rgb(23, 45, 67)',
    backgroundColor: 'rgb(23, 45, 67)',
  })
})

it.each([
  'url(https://example.com)',
  'expression(alert(1))',
  'var(--missing-token)',
  'var(--cycle-token)',
  'var(--invalid-token)',
])('refuses invalid or unresolved token colour %s', async (value) => {
  const { host, editor } = mount('alpha beta\nlast', false, 'Snapshot Mono', false)
  host.style.setProperty('--cycle-token', 'var(--cycle-token)')
  host.style.setProperty('--invalid-token', 'url(https://example.com)')
  for (const property of ['color', 'backgroundColor'] as const) {
    editor.setTokens([{ start: 0, end: 5, style: { [property]: value } }])
    await frames()
    expect(editor.captureSnapshot({ scope: 'document' }).status).toBe('unsupported')
  }
})

it.each(['light', 'dark'] as const)(
  'resolves colours in the active %s colour scheme',
  async (scheme) => {
    const { host, editor } = mount('alpha beta\nlast', false, 'Snapshot Mono', false)
    host.style.colorScheme = scheme
    editor.setTokens([
      { start: 0, end: 5, style: { color: 'light-dark(rgb(12, 34, 56), rgb(78, 90, 12))' } },
    ])
    await frames()
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const paint = decodePaintSnapshot(saved.paint)!
    expect(paint.format).toBe(6)
    if (paint.format !== 6) return
    expect(paint.rows[0]!.runs[0]!.style.color).toBe(
      scheme === 'light' ? 'rgb(12, 34, 56)' : 'rgb(78, 90, 12)',
    )
  },
)

it('isolates token resolution from hostile descendant CSS', async () => {
  const { host, editor } = mount('alpha beta\nlast', false, 'Snapshot Mono', false)
  const stylesheet = document.createElement('style')
  stylesheet.textContent =
    '#document-paint-proof .editor-virtualized-row > span { color: rgb(0, 0, 255) !important; }'
  document.head.append(stylesheet)
  try {
    editor.setTokens([{ start: 0, end: 5, style: { color: 'rgb(255, 0, 0)' } }])
    await frames()
    const live = await pixels('hostile-css-live')
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const paint = decodePaintSnapshot(saved.paint)!
    expect(paint.format).toBe(6)
    if (paint.format !== 6) return
    expect(paint.rows[0]!.runs[0]!.style.color).toBe('rgb(255, 0, 0)')
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0'
    host.append(overlay)
    const restored = mountPaintSnapshot(overlay, paint, { width: 1280 })!
    host.querySelector<HTMLElement>('.editor-virtualized')!.style.visibility = 'hidden'
    expect(changedPixels(live, await pixels('hostile-css-static'))).toBe(0)
    restored.dispose()
    overlay.remove()
  } finally {
    stylesheet.remove()
  }
})
