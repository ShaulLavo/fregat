/**
 * Progressive enhancement for docs pages. The static page is complete on its own. On a desktop
 * pointer the real Singapore editor mounts behind it, opens the same Markdown, and takes over once
 * its live preview has painted, at the same scroll position. Docs links then open in the same
 * editor and update the address bar.
 */
import GithubSlugger from 'github-slugger'
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
// Only the latest navigation may open a document or touch history.
let navigation = 0

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
  // The reader may have scrolled the static page while the editor loaded.
  const anchor = topLine()
  scrollToLine(anchor.line, anchor.offset)
  await new Promise((resolve) => requestAnimationFrame(resolve))
  host.dataset.state = 'ready'
  body.dataset.mode = 'editor'
  docs.editor.setPresentationReady(true)
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

// Readers who prefer the plain page keep it on every page. The editor exposes only its mounted
// rows to assistive technology, while the static article holds the whole page.
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
  if (href.startsWith('#')) {
    void openFile(current, true, href)
    return
  }
  const target = resolveDocsLink(current, href, base, files)
  const url = new URL(target.href, location.href)
  if (target.md) {
    void openFile(target.md, true, url.hash)
    return
  }
  if (url.origin === location.origin) location.href = url.href
  else window.open(url.href, '_blank', 'noopener')
}

/** The source line of the heading a fragment names, with the ids the static page gives them. */
function headingLine(text: string, hash: string): number | null {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id) return null
  const slugger = new GithubSlugger()
  let fence = false
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = fence ? null : line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/)
    if (!heading) continue
    const visible = heading[1]!.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '')
    if (slugger.slug(visible.trim()) === id) return index + 1
  }
  return null
}

/** A heading the fragment names, else the place a history entry recorded, else the top. */
function reveal(hash: string, place?: number) {
  const line = headingLine(tabs.get(current)?.text ?? '', hash)
  if (line !== null) scrollToLine(line)
  else docs?.editor.setScrollPosition({ top: place ?? 0 })
}

// Back must return to where the reader was, so the outgoing entry keeps its scroll position.
function pushEntry(file: string, hash: string, url: string) {
  const place = docs?.editor.getScrollPosition().top
  history.replaceState({ ...(history.state as object | null), place }, '')
  history.pushState({ file, hash }, '', url)
}

async function openFile(file: string, push: boolean, hash = '', place?: number) {
  const id = ++navigation
  const page = pages.get(file)
  if (!page) return
  if (!docs) {
    location.href = page.url + hash
    return
  }
  if (file === current) {
    if (push && hash) pushEntry(file, hash, page.url + hash)
    if (push && !hash) return
    reveal(hash, place)
    return
  }
  const previous = tabs.get(current)
  if (previous) previous.text = docs.text()
  let text: string
  try {
    text = await source(file)
  } catch (error) {
    console.error(`Loading ${file} failed; opening its page.`, error)
    if (id === navigation) location.href = page.url + hash
    return
  }
  if (id !== navigation || !docs) return
  if (!tabs.has(file)) tabs.set(file, { text, original: text })
  current = file
  const tab = tabs.get(file)!
  docs.open(file, tab.text)
  docs.editor.setSelection(tab.text.length)
  docs.editor.setScrollPosition({ top: 0 })
  docs.element.setAttribute('aria-label', label(file))
  body.dataset.file = file
  document.title = `${page.title} · Singapore docs`
  if (push) pushEntry(file, hash, page.url + hash)
  const [directory, name] = splitPath(file)
  document.querySelector('.path')!.innerHTML = `docs/${directory}<b></b>`
  document.querySelector('.path b')!.textContent = name
  for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-md]')) {
    if (link.dataset.md === file) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  updateDirty()
  try {
    await docs.ready()
  } catch (error) {
    // The static page for this file still reads correctly.
    console.error(`The preview for ${file} did not paint; opening its page.`, error)
    if (id === navigation) location.href = page.url + hash
    return
  }
  if (id === navigation) reveal(hash, place)
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
  link.closest('details')?.removeAttribute('open')
  void openFile(link.dataset.md, true, link.hash)
})

window.addEventListener('popstate', (event) => {
  const state = event.state as { file?: string; hash?: string; place?: number } | null
  if (state?.file) void openFile(state.file, false, state.hash ?? location.hash, state.place)
})
history.replaceState({ file: current, hash: location.hash }, '')

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
    docs?.dispose()
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

// The header page menu closes on Escape and on a press outside it.
const menu = document.querySelector<HTMLDetailsElement>('details.menu')
document.addEventListener('pointerdown', (event) => {
  if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !menu?.open) return
  menu.open = false
  menu.querySelector('summary')?.focus()
})
