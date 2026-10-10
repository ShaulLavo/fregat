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
import '../src/style.css'
import '../../gutters/src/lineGutter.css'
import '../../markdown/src/style.css'

import largestManual from '../../../site/src/content/docs/docs/guides/frameworks.md?raw'
import manual from '../../../site/src/content/docs/docs/start-here/quick-start.md?raw'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofDocumentPaintScreenshot(label: string): Promise<string>
    proofDocumentPaintResult(result: Record<string, unknown>, payload: string): Promise<void>
  }
}

const monoUrl = new URL('./fixtures/fonts/jetbrains-mono.woff2', import.meta.url).href
const serifUrl = new URL('./fixtures/fonts/source-serif-4.woff2', import.meta.url).href
const mounted: { editor?: Editor; host: HTMLElement; dispose?: () => void }[] = []

beforeAll(async () => {
  const mask = document.createElement('style')
  mask.textContent = '.editor-virtualized-caret { visibility: hidden !important; }'
  document.head.append(mask)
  await init()
  for (const [family, url] of [
    ['Snapshot Mono', monoUrl],
    ['Snapshot Serif', serifUrl],
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
  if (parser)
    editor.setInlineReplacementProvider(
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
  else editor.setTokens([{ start: 0, end: 5, style: { color: '#cc3311' } }])
  return { host, editor, options, item }
}

async function frames() {
  for (let index = 0; index < 3; index++) await new Promise(requestAnimationFrame)
}

async function pixels(label: string): Promise<ImageData> {
  const screenshot = await commands.proofDocumentPaintScreenshot(label)
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
    expect(saved.status).toBe('ready')
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
      const samples: number[] = []
      const target = document.createElement('div')
      target.style.cssText = 'position:absolute;left:0;top:0'
      host.append(target)
      for (let iteration = 0; iteration < 30; iteration++) {
        const start = performance.now()
        const decoded = decodePaintSnapshot(saved.paint)!
        const mounted = mountPaintSnapshot(target, decoded, { width })!
        mounted.element.getBoundingClientRect()
        samples.push(performance.now() - start)
        mounted.dispose()
      }
      target.remove()
      samples.sort((a, b) => a - b)
      await commands.proofDocumentPaintResult(
        {
          fixture: 'code',
          width,
          dark,
          dpr: devicePixelRatio,
          samples,
          p95: samples[28],
          rowCount: restored.rowCount,
          height,
        },
        saved.paint,
      )
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
] as const)(
  'captures real Markdown preview and preserves its links, headings and text in %s, dark=%s',
  async (family, dark) => {
    const text =
      '# Heading\n**bold** *italic* ~~strike~~ `inline code`\nread [the long label with words and averylongidentifier](https://example.com) now\n\n' +
      manual +
      '\nlast'
    const { host, editor } = mount(text, true, family, dark)
    await frames()
    expect(editor.captureSnapshot()).toBeNull()
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const paint = decodePaintSnapshot(saved.paint)!
    for (const width of [320, 390, 1280]) {
      host.style.width = `${width}px`
      await frames()
      const liveText = [...host.querySelectorAll('[data-editor-virtual-row]')]
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
      restored.dispose()
      overlay.remove()
      scroller.style.visibility = ''
      await benchmark(saved.paint, width, { fixture: 'manual', family, dark })
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
  expect(saved.status).toBe('ready')
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
  const target = document.createElement('div')
  target.style.cssText = 'position:absolute;left:0;top:0'
  document.body.append(target)
  for (let iteration = 0; iteration < 30; iteration++) {
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
    mounted.dispose()
  }
  target.remove()
  const sorted = samples.toSorted((a, b) => a - b)
  await commands.proofDocumentPaintResult(
    { ...fixture, width, dpr: devicePixelRatio, samples, decode, mount, layout, p95: sorted[28] },
    payload,
  )
}

it('measures the largest checked-in manual at every required width', async () => {
  const { editor } = mount(largestManual + '\nlast', true, 'Snapshot Serif', false)
  await frames()
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status).toBe('ready')
  if (saved.status !== 'ready') return
  for (const width of [320, 390, 1280])
    await benchmark(saved.paint, width, { fixture: 'largest-manual' })
})
