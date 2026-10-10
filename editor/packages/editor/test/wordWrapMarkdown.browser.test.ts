import { beforeAll, expect, test } from 'vitest'
import { commands, page } from 'vitest/browser'

import { init, MarkdownDocument } from 'tree-sitter-md'
import { markdownInlineReplacements } from '../../markdown/src/replacements'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'
import { Editor } from '../src/editor/Editor'
import { glyphAdvancesFor, PROPORTIONAL_WRAP_MARGIN_PX } from '../src/virtualization/glyphAdvances'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'
import { decodePaintSnapshot, mountPaintSnapshot } from '../src/paint'
import quickStart from '../../../site/src/content/docs/docs/start-here/quick-start.md?raw'
import codeMirror from '../../../site/src/content/docs/docs/start-here/codemirror.md?raw'
import '../src/style.css'
import '../../markdown/src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofStyledWrapScreenshot(width: number): Promise<string>
  }
}

beforeAll(() => init())

const LABEL = 'the long label with words and averylongidentifier'
const LINE = `read [${LABEL}](https://example.com) now`
const TEXT = `${LINE}\nlast`

function rowText(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
    .filter((row) => row.style.display !== 'none')
    .sort(
      (left, right) =>
        Number(left.dataset.editorVirtualRow) - Number(right.dataset.editorVirtualRow),
    )
    .map((row) => row.textContent ?? '')
    .join('')
}

function expectContained(container: HTMLElement): void {
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
  expect(scroller.scrollWidth).toBe(scroller.clientWidth)
  const edge = scroller.getBoundingClientRect().left + scroller.clientWidth
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let checked = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('[data-editor-virtual-row]')) continue
    const end = node.data.trimEnd().length
    if (end === 0) continue
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, end)
    expect(range.getBoundingClientRect().right, node.data).toBeLessThanOrEqual(edge + 0.5)
    checked += 1
  }
  expect(checked).toBeGreaterThan(1)
}

test.each([160, 320, 390])(
  'wraps link fragments and releases their mounts on resize and reveal at %i px',
  async (width) => {
    const container = document.createElement('div')
    container.style.cssText = `display:flex;width:${width}px;height:600px`
    document.body.append(container)
    const editor = new Editor(container, {
      wordWrap: true,
      wordWrapBreak: 'word',
      fontFamily: 'monospace',
      fontSize: 16,
    })
    const parser = new MarkdownDocument()
    let mounted = 0
    let disposed = 0
    const opened: string[] = []
    try {
      parser.setText(TEXT)
      const specs = markdownInlineReplacements(
        createStringTextSnapshot(TEXT),
        parser.decorations(0, TEXT.length),
        {
          openLink: (href) => opened.push(href),
          registerKeymapNode: () => {
            mounted += 1
            return {
              dispose: () => {
                disposed += 1
              },
            }
          },
        },
      )
      editor.setText(TEXT)
      editor.setSelection(TEXT.length)
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      await expect.poll(() => container.querySelectorAll('a').length).toBeGreaterThan(1)
      expectContained(container)
      const links = [...container.querySelectorAll('a')]
      expect(links.map((anchor) => anchor.textContent ?? '').join('')).toBe(LABEL)
      for (const anchor of links) {
        expect(anchor.href).toBe('https://example.com/')
        anchor.click()
      }
      expect(opened).toEqual(links.map(() => 'https://example.com'))
      const initialMounts = mounted
      container.style.width = '120px'
      // Refresh the preview while ResizeObserver delivery is pending.
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => disposed).toBeGreaterThanOrEqual(initialMounts)
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      // Replacement disposal can finish before the resize frame updates the editor's extent.
      const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
      await expect.poll(() => scroller.clientWidth).toBe(120)
      await expect.poll(() => scroller.scrollWidth).toBe(120)
      expectContained(container)
      const resizedMounts = mounted
      editor.setSelection(TEXT.indexOf('long') + 1)
      await expect.poll(() => container.querySelectorAll('a').length).toBe(0)
      await expect.poll(() => rowText(container)).toBe(`${LINE}last`)
      await expect.poll(() => disposed).toBe(resizedMounts)
      expectContained(container)
      editor.setSelection(TEXT.length)
      await expect.poll(() => rowText(container)).toBe(`read ${LABEL} nowlast`)
      expectContained(container)
      await page.elementLocator(container).screenshot()
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
    }
    expect(disposed).toBe(mounted)
  },
)

test.each([
  [
    'read **averylongidentifier** and _emphasized words_ now',
    'read averylongidentifier and emphasized words now',
  ],
  [
    'use `@singapore-editor/tree-sitter-languages` now',
    'use @singapore-editor/tree-sitter-languages now',
  ],
])(
  'keeps Markdown preview and revealed marks inside a narrow row for %s',
  async (line, preview) => {
    const container = document.createElement('div')
    container.style.cssText = 'display:flex;width:160px;height:600px'
    document.body.append(container)
    const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
    const parser = new MarkdownDocument()
    const text = `${line}\nlast`
    try {
      parser.setText(text)
      const specs = markdownInlineReplacements(
        createStringTextSnapshot(text),
        parser.decorations(0, text.length),
      )
      editor.setText(text)
      editor.setSelection(text.length)
      editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
      await expect.poll(() => rowText(container)).toBe(`${preview}last`)
      expectContained(container)
      const target = line.includes('**') ? line.indexOf('averylongidentifier') : line.indexOf('@')
      editor.setSelection(target + 2)
      await expect
        .poll(() =>
          rowText(container).includes(
            line.includes('**')
              ? '**averylongidentifier**'
              : '`@singapore-editor/tree-sitter-languages`',
          ),
        )
        .toBe(true)
      expectContained(container)
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
    }
  },
)

test('wraps padded Markdown table links without repeating the label', async () => {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;width:160px;height:600px'
  document.body.append(container)
  const editor = new Editor(container, { wordWrap: true, wordWrapBreak: 'word' })
  const parser = new MarkdownDocument()
  const text = `| Item |\n| --- |\n| [**${LABEL}**](https://example.com) |\nlast`
  try {
    parser.setText(text)
    const specs = markdownInlineReplacements(
      createStringTextSnapshot(text),
      parser.decorations(0, text.length),
    )
    editor.setText(text)
    editor.setSelection(text.length)
    editor.setInlineReplacementProvider(() => specs, { trigger: 'edit' })
    await expect
      .poll(() =>
        Array.from(container.querySelectorAll('a'), (anchor) => anchor.textContent ?? '').join(''),
      )
      .toBe(LABEL)
    expectContained(container)
  } finally {
    editor.dispose()
    parser.dispose()
    container.remove()
  }
})

const HEADINGS =
  '# Give the editor a container with enough room for every heading\n## 2. Give the editor a container\n### A longer heading with preview styling and wrapping enabled\nlast'

test.each([320, 390])(
  'wraps each heading font and replays identical rows at %i px',
  async (width) => {
    await checkStyledPreview(HEADINGS, width, true)
  },
)

test.each([
  ['Quick start', quickStart],
  ['CodeMirror', codeMirror],
])('contains the live %s manual at phone widths', async (_name, text) => {
  for (const width of [312, 320, 390]) await checkStyledPreview(text, width, false)
})

async function checkStyledPreview(text: string, width: number, replay: boolean): Promise<void> {
  const container = document.createElement('div')
  container.style.cssText = `position:relative;width:${width}px`
  document.body.append(container)
  container.dataset.styledWrapProof = ''
  const editor = new Editor(container, {
    scrollMode: 'content',
    wordWrap: true,
    wordWrapBreak: 'word',
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 26,
  })
  const parser = new MarkdownDocument()
  let paintHost: HTMLElement | null = null
  let disposePaint: (() => void) | undefined
  try {
    parser.setText(text)
    editor.setText(text)
    editor.setSelection(text.length)
    editor.setInlineReplacementProvider(
      () =>
        markdownInlineReplacements(
          createStringTextSnapshot(text),
          parser.decorations(0, text.length),
        ),
      { trigger: 'edit' },
    )
    const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
    await expect
      .poll(
        () =>
          container.querySelectorAll('[data-editor-virtual-row].editor-inline-heading-marker-2')
            .length,
      )
      .toBeGreaterThan(0)
    await expect.poll(() => scroller.clientWidth).toBe(width)
    await expect.poll(() => scroller.scrollWidth).toBe(width)
    expectContained(container)
    if (!replay) return
    const saved = editor.captureSnapshot({ scope: 'document' })
    expect(saved.status, JSON.stringify(saved)).toBe('ready')
    if (saved.status !== 'ready') return
    const decoded = decodePaintSnapshot(saved.paint)!
    expect(decoded.format).toBe(6)
    if (decoded.format !== 6) return
    // Engines quantize computed font sizes to their subpixel layout units.
    for (const [index, size] of [18.9, 16.8, 15.4].entries())
      expect(Number.parseFloat(decoded.rows[index]!.style.fontSize)).toBeCloseTo(size, 1)
    const rowElements = [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
    for (const [index, row] of decoded.rows.entries()) {
      const live = rowElements.find((element) =>
        element.textContent?.startsWith(row.runs[0]?.text.slice(0, 8) ?? ''),
      )
      expect(live).toBeDefined()
      expect(row.characterWidth).toBe(glyphAdvancesFor(live!)!.advance(48))
      if (index < 3) expect(row.characterWidth).toBeGreaterThan(decoded.characterWidth)
    }
    const liveRows = [...container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
      .sort((a, b) => Number(a.dataset.editorVirtualRow) - Number(b.dataset.editorVirtualRow))
      .map((row) => row.textContent)
    paintHost = document.createElement('div')
    paintHost.style.width = `${width}px`
    document.body.append(paintHost)
    const paint = mountPaintSnapshot(paintHost, decoded, { width })!
    expect(paint).not.toBeNull()
    disposePaint = () => paint.dispose()
    const staticRows = [...paintHost.querySelectorAll('[data-editor-document-paint-row]')]
    expect(staticRows.map((row) => row.textContent)).toEqual(liveRows)
    expect(paintHost.scrollWidth).toBe(paintHost.clientWidth)
    console.info('Styled wrap evidence', await commands.proofStyledWrapScreenshot(width))
    container.style.width = `${width === 320 ? 390 : 320}px`
    await expect.poll(() => scroller.clientWidth).toBe(width === 320 ? 390 : 320)
    await expect.poll(() => scroller.scrollWidth).toBe(scroller.clientWidth)
    expectContained(container)
    editor.setSelection(text.indexOf('2. Give') + 2)
    await expect
      .poll(
        () =>
          container.querySelectorAll('[data-editor-virtual-row].editor-inline-heading-marker-2')
            .length,
      )
      .toBe(0)
    expectContained(container)
    editor.setSelection(text.length)
    await expect
      .poll(
        () =>
          container.querySelectorAll('[data-editor-virtual-row].editor-inline-heading-marker-2')
            .length,
      )
      .toBeGreaterThan(0)
    expectContained(container)
  } finally {
    disposePaint?.()
    paintHost?.remove()
    editor.dispose()
    parser.dispose()
    container.remove()
  }
}

async function settleStyledRows(): Promise<void> {
  for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame)
}

function previewRows(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-editor-virtual-row]')].map((row) => row.textContent)
}

async function expectStyledReplay(editor: Editor, container: HTMLElement): Promise<void> {
  const saved = editor.captureSnapshot({ scope: 'document' })
  expect(saved.status, JSON.stringify(saved)).toBe('ready')
  if (saved.status !== 'ready') return
  const decoded = decodePaintSnapshot(saved.paint)!
  if (decoded.format === 6) {
    const row = container.querySelector<HTMLElement>('[data-editor-virtual-row]')!
    expect(decoded.rows[0]!.characterWidth).toBe(glyphAdvancesFor(row)!.advance(48))
  }
  const host = document.createElement('div')
  host.style.width = `${container.clientWidth}px`
  document.body.append(host)
  const paint = mountPaintSnapshot(host, decoded, { width: container.clientWidth })
  try {
    expect(paint).not.toBeNull()
    expect(host.scrollWidth).toBe(host.clientWidth)
    expect(
      [...host.querySelectorAll('[data-editor-document-paint-row]')].map((row) => row.textContent),
    ).toEqual(previewRows(container))
  } finally {
    paint?.dispose()
    host.remove()
  }
}

test.each(['theme', 'stylesheet', 'font'] as const)(
  'rewraps a heading-only %s change while the base font stays unchanged',
  async (change) => {
    const sheet = document.createElement('style')
    const family = 'Styled Wrap Late Heading'
    const fallbackFamily = 'Styled Wrap Heading Fallback'
    let fallback: FontFace | undefined
    if (change === 'font') {
      fallback = new FontFace(
        fallbackFamily,
        `url("${new URL('./fixtures/fonts/jetbrains-mono.woff2', import.meta.url).href}")`,
      )
      document.fonts.add(await fallback.load())
      clearBrowserTextMetricsCache()
    }
    sheet.textContent =
      change === 'theme'
        ? '.editor-virtualized[data-editor-theme-type="dark"] .editor-inline-heading-marker-1 {font-size:24px}'
        : ''
    if (change === 'font')
      sheet.textContent = `.editor-inline-heading-marker-1 {font-family:"${family}","${fallbackFamily}"}`
    document.head.append(sheet)
    const container = document.createElement('div')
    container.style.cssText = 'position:relative;width:320px'
    container.dataset.styledWrapProof = ''
    document.body.append(container)
    const text = '# ' + 'WWWWW WWWWW '.repeat(10) + '\nlast'
    const editor = new Editor(container, {
      scrollMode: 'content',
      wordWrap: true,
      wordWrapBreak: 'word',
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 32,
    })
    const parser = new MarkdownDocument()
    let face: FontFace | undefined
    try {
      parser.setText(text)
      editor.setText(text)
      editor.setSelection(text.length)
      editor.setInlineReplacementProvider(
        () =>
          markdownInlineReplacements(
            createStringTextSnapshot(text),
            parser.decorations(0, text.length),
          ),
        { trigger: 'edit' },
      )
      await expect
        .poll(() => container.querySelectorAll('[data-editor-virtual-row]').length)
        .toBeGreaterThan(2)
      await settleStyledRows()
      expectContained(container)
      const before = previewRows(container)
      const initialHeading = container.querySelector<HTMLElement>(
        '[data-editor-virtual-row].editor-inline-heading-marker-1',
      )!
      const beforeAdvance = glyphAdvancesFor(initialHeading)!.advance(87)
      const scroller = container.querySelector<HTMLElement>('.editor-virtualized')!
      const baseFont = getComputedStyle(scroller).font
      if (change === 'theme') editor.setTheme({ type: 'dark' })
      if (change === 'stylesheet')
        sheet.textContent =
          '.editor-virtualized-row.editor-inline-heading-marker-1 {font-size:24px}'
      if (change === 'font') {
        face = new FontFace(
          family,
          `url("${new URL('./fixtures/freefont/FreeSans.ttf', import.meta.url).href}")`,
        )
        document.fonts.add(await face.load())
        await document.fonts.ready
      }
      await settleStyledRows()
      expect(getComputedStyle(scroller).font).toBe(baseFont)
      await expect.poll(() => scroller.scrollWidth).toBe(scroller.clientWidth)
      if (change !== 'font') await expect.poll(() => previewRows(container)).not.toEqual(before)
      expectContained(container)
      const heading = container.querySelector<HTMLElement>(
        '[data-editor-virtual-row].editor-inline-heading-marker-1',
      )!
      if (change === 'font') {
        const node = document.createTextNode('W')
        const probe = document.createElement('span')
        probe.append(node)
        heading.append(probe)
        const range = document.createRange()
        range.selectNodeContents(probe)
        expect(glyphAdvancesFor(heading)!.advance(87)).not.toBeCloseTo(beforeAdvance, 1)
        // Canvas and DOM shaping may differ within the wrapper's native-layout reserve.
        expect(
          Math.abs(glyphAdvancesFor(heading)!.advance(87) - range.getBoundingClientRect().width),
        ).toBeLessThanOrEqual(PROPORTIONAL_WRAP_MARGIN_PX)
        probe.remove()
      }
      await expectStyledReplay(editor, container)
      console.info(
        'Styled invalidation evidence',
        change,
        await commands.proofStyledWrapScreenshot(320),
      )
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
      sheet.remove()
      if (face) document.fonts.delete(face)
      if (fallback) document.fonts.delete(fallback)
      clearBrowserTextMetricsCache()
    }
  },
)

test.each([
  ['default', 316, ''],
  ['30px', 320, '.editor-virtualized-row.editor-inline-heading-marker-1 {font-size:30px}'],
] as const)(
  'reserves the effective %s heading caret width for live and static hanging spaces',
  async (_name, width, css) => {
    const sheet = document.createElement('style')
    sheet.textContent = css
    document.head.append(sheet)
    const container = document.createElement('div')
    container.style.cssText = `position:relative;width:${width}px`
    container.dataset.styledWrapProof = ''
    document.body.append(container)
    const text =
      width === 316
        ? '# ' + 'W'.repeat(27) + ' ' + 'W'.repeat(10) + '\nlast'
        : '# ' + 'WWWWW WWWWW '.repeat(10) + '\nlast'
    const editor = new Editor(container, {
      scrollMode: 'content',
      wordWrap: true,
      wordWrapBreak: 'word',
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 32,
    })
    const parser = new MarkdownDocument()
    try {
      parser.setText(text)
      editor.setText(text)
      editor.setSelection(text.length)
      editor.setInlineReplacementProvider(
        () =>
          markdownInlineReplacements(
            createStringTextSnapshot(text),
            parser.decorations(0, text.length),
          ),
        { trigger: 'edit' },
      )
      await expect
        .poll(() => container.querySelectorAll('[data-editor-virtual-row]').length)
        .toBeGreaterThan(2)
      await settleStyledRows()
      expectContained(container)
      await expectStyledReplay(editor, container)
      console.info('Styled budget evidence', _name, await commands.proofStyledWrapScreenshot(width))
    } finally {
      editor.dispose()
      parser.dispose()
      container.remove()
      sheet.remove()
      clearBrowserTextMetricsCache()
    }
  },
)
