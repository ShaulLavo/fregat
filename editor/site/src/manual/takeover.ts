/**
 * Progressive enhancement for docs pages. The static page is complete on its own. On a desktop
 * pointer the real Singapore editor mounts behind it, opens the same Markdown, and takes over once
 * its live preview has painted, at the same scroll position. Docs links then open in the same
 * editor and update the address bar.
 */
import type { DocsEditor } from './editor'
import { resolveDocsLink, type ManualPage } from './links'
import { setUpSearch } from './search'
import { onThemeChange } from './theme-toggle'

const body = document.body
const pane = document.getElementById('doc')!
const viewport = pane.parentElement!
const base = import.meta.env.BASE_URL
const pages = new Map<string, ManualPage>(
  (JSON.parse(document.getElementById('manual-pages')!.textContent!) as ManualPage[]).map(
    (page) => [page.file, page],
  ),
)
const files = new Set(pages.keys())
const forced = new URLSearchParams(location.search).get('editor')
const AUTO = matchMedia('(pointer: fine) and (min-width: 761px)')
const PREFERENCE = 'singapore-docs-reader'
const ROW = 22
const metrics: Record<string, unknown> = { started: performance.now() }
Object.assign(window, { __docs: metrics })

const tabs = new Map<string, { text: string; original: string }>()
let current = body.dataset.file!
let docs: DocsEditor | null = null
let host: HTMLElement | null = null

const readerPreferred = () => {
  try {
    return localStorage.getItem(PREFERENCE) === 'page'
  } catch {
    return false
  }
}
const shouldTakeOver = () =>
  forced === 'on' || (forced !== 'off' && !readerPreferred() && AUTO.matches)

function topLine() {
  const top = pane.getBoundingClientRect().top
  for (const row of pane.querySelectorAll<HTMLElement>('.r[data-n]')) {
    const rect = row.getBoundingClientRect()
    if (rect.bottom > top + 0.5) return { line: Number(row.dataset.n), offset: top - rect.top }
  }
  return { line: 1, offset: 0 }
}

async function source(file: string): Promise<string> {
  const open = tabs.get(file)
  if (open) return open.text
  const page = pages.get(file)
  if (!page) throw new TypeError(`No docs page ${file}`)
  const response = await fetch(page.source)
  if (!response.ok) throw new TypeError(`Loading ${page.source} answered ${response.status}`)
  return response.text()
}

async function takeOver() {
  if (docs) return
  body.dataset.mode = 'mounting'
  setMode('Loading editor…')
  const css = getComputedStyle(pane.querySelector('.src')!)
  const [mountDocsEditor, text] = await Promise.all([
    import('./editor').then(({ mountDocsEditor }) => mountDocsEditor),
    source(current),
    document.fonts.load(`${css.fontSize} "JetBrains Mono"`),
  ])
  metrics.moduleMs = performance.now() - (metrics.started as number)
  tabs.set(current, { text, original: text })
  host = document.createElement('div')
  host.className = 'editor-host'
  // The static <main> leaves with display: none; the editor keeps the landmark.
  host.setAttribute('role', 'main')
  host.setAttribute('aria-label', 'Page source')
  host.dataset.state = 'mounting'
  viewport.append(host)
  const anchor = topLine()
  docs = mountDocsEditor(host, {
    documentId: current,
    languageId: 'markdown',
    text,
    lineHeight: ROW,
    fontSize: parseFloat(css.fontSize),
    fontFamily: css.fontFamily,
    gutterWidth: parseFloat(getComputedStyle(body).getPropertyValue('--gw')),
    label: label(current),
    openLink,
  })
  // A caret touching a construct reveals its Markdown source, focused or not; park it at the end.
  docs.editor.setSelection(text.length)
  metrics.previewMs = await docs.ready()
  scrollToLine(anchor.line, anchor.offset)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  host.dataset.state = 'ready'
  body.dataset.mode = 'editor'
  if (pane.contains(document.activeElement)) docs.editor.focus()
  metrics.takeoverMs = performance.now() - (metrics.started as number)
  offerPage()
  docs.onChange(updateDirty)
  updateDirty()
}

const label = (file: string) => `${file}, Markdown source with live preview`

// Row tops are known only for mounted rows, so scroll by estimate, then correct from the DOM.
function scrollToLine(line: number, offset = 0) {
  if (!docs) return
  const editor = docs.editor
  const index = Math.min(line - 1, editor.getTextSnapshot().lineCount - 1)
  editor.setScrollPosition({ top: Math.max(0, index * ROW + offset) })
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = rowElement(index)
    if (!row) return
    const scroller = docs.element.querySelector('.editor-virtualized')!.getBoundingClientRect()
    const delta = row.getBoundingClientRect().top - scroller.top + offset
    if (Math.abs(delta) < 0.5) return
    editor.setScrollPosition({ top: Math.max(0, editor.getScrollPosition().top + delta) })
  }
}

// The first display row of a logical line: the gutter labels it with that line's number.
function rowElement(index: number) {
  const labels = docs!.element.querySelectorAll<HTMLElement>(
    '.editor-virtualized-line-number:not([hidden])',
  )
  const label = [...labels].find((cell) => cell.style.counterSet === `editor-line ${index + 1}`)
  const gutterRow = label?.closest<HTMLElement>('[data-editor-virtual-gutter-row]')
  if (!gutterRow) return null
  return docs!.element.querySelector(
    `[data-editor-virtual-row="${gutterRow.dataset.editorVirtualGutterRow}"]`,
  )
}

function updateDirty() {
  const tab = tabs.get(current)
  if (!docs || !tab) return
  tab.text = docs.text()
  const path = document.querySelector('.path')!
  const mark = path.querySelector('.dirty')
  const dirty = tab.text !== tab.original
  if (dirty && !mark) {
    const dot = document.createElement('span')
    dot.className = 'dirty'
    dot.textContent = '●'
    dot.title = 'Edited in this browser tab'
    path.append(dot)
  }
  if (!dirty) mark?.remove()
}

function setMode(text: string) {
  document.querySelector('.mode')!.textContent = text
}

function modeButton(text: string, action: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.addEventListener('click', action)
  document.querySelector('.mode')!.replaceChildren(button)
}

function setReaderPreference(page: boolean) {
  try {
    if (page) localStorage.setItem(PREFERENCE, 'page')
    else localStorage.removeItem(PREFERENCE)
  } catch {}
}

// Readers who prefer the plain page (for example with a screen reader) keep it on every page.
function offerPage() {
  modeButton('Read as page', () => {
    setReaderPreference(true)
    const page = pages.get(current)!
    location.href = page.url
  })
}

function offerEditor() {
  modeButton('Open in editor', () => {
    setReaderPreference(false)
    void start()
  })
}

function openLink(href: string) {
  const target = resolveDocsLink(current, href, base, files)
  if (target.md) {
    void openFile(target.md, true)
    return
  }
  const url = new URL(target.href, location.href)
  if (url.origin === location.origin) location.href = url.href
  else window.open(url.href, '_blank', 'noopener')
}

async function openFile(file: string, push: boolean) {
  const page = pages.get(file)
  if (!page) return
  if (!docs) {
    location.href = page.url
    return
  }
  if (file === current) return
  const previous = tabs.get(current)
  if (previous) previous.text = docs.text()
  const text = await source(file)
  if (!tabs.has(file)) tabs.set(file, { text, original: text })
  current = file
  const tab = tabs.get(file)!
  docs.open(file, tab.text)
  docs.editor.setSelection(tab.text.length)
  docs.editor.setScrollPosition({ top: 0 })
  docs.element.setAttribute('aria-label', label(file))
  body.dataset.file = file
  document.title = `${page.title} · Singapore docs`
  if (push) history.pushState({ file }, '', page.url)
  const [directory, name] = splitPath(file)
  document.querySelector('.path')!.innerHTML = `docs/${directory}<b></b>`
  document.querySelector('.path b')!.textContent = name
  for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-md]')) {
    if (link.dataset.md === file) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  updateDirty()
  await docs.ready()
}

const splitPath = (file: string) => {
  const slash = file.lastIndexOf('/') + 1
  return [file.slice(0, slash), file.slice(slash)] as const
}

// After takeover, docs links open in the editor.
document.addEventListener('click', (event) => {
  if (!docs || event.defaultPrevented || event.button !== 0) return
  const target = event.target as Element
  if (target.closest('.skip')) {
    event.preventDefault()
    docs.editor.focus()
    return
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = target.closest<HTMLAnchorElement>('a[data-md]')
  if (!link?.dataset.md || !pages.has(link.dataset.md)) return
  event.preventDefault()
  link.closest('dialog')?.close()
  void openFile(link.dataset.md, true)
})

window.addEventListener('popstate', (event) => {
  const file = (event.state as { file?: string } | null)?.file
  if (file) void openFile(file, false)
})
history.replaceState({ file: current }, '')

// The column has no scrollbar of its own; a wheel anywhere in the margins scrolls it.
viewport.addEventListener(
  'wheel',
  (event) => {
    const target = event.target as Element
    if (target.closest('.pane, .editor-host, nav') || event.ctrlKey) return
    if (!matchMedia('(min-width: 761px)').matches) return
    const unit = event.deltaMode === 1 ? ROW : event.deltaMode === 2 ? viewport.clientHeight : 1
    const delta = event.deltaY * unit
    event.preventDefault()
    if (!docs) {
      pane.scrollTop += delta
      return
    }
    const position = docs.editor.getScrollPosition()
    docs.editor.setScrollPosition({ top: Math.max(0, position.top + delta) })
  },
  { passive: false },
)

onThemeChange(() => docs?.refreshTheme())
setUpSearch(
  new Map(
    [...pages.values()].map((page) => [new URL(page.url, location.href).pathname, page.file]),
  ),
)

function start() {
  return takeOver().catch((error: unknown) => {
    console.error('Singapore takeover failed; the static page stays.', error)
    host?.remove()
    host = null
    docs = null
    body.dataset.mode = 'static'
    offerEditor()
  })
}

if (shouldTakeOver()) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => void start(), { timeout: 300 })
  else setTimeout(() => void start(), 0)
} else {
  offerEditor()
}
