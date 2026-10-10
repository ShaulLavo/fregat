import {
  decodePaintSnapshot,
  mountPaintSnapshot,
  type MountedPaintSnapshot,
} from '@singapore-editor/core/paint'
import type { ReaderDocument } from './captured'
import type { DocsEditor } from './editor'
import { documentOptions } from './configuration'
import { resolveDocsLink, type ManualPage } from './links'
import { setUpSearch } from './search'
import { onThemeChange } from './theme-toggle'

const palette = (): 'light' | 'dark' =>
  getComputedStyle(document.documentElement).colorScheme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark'
    : 'light'
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export async function startReader(home: boolean) {
  const body = document.body
  const container = document.querySelector<HTMLElement>(home ? '.hero-box' : '#doc')!
  const article = container.querySelector<HTMLElement>('.paint-article')!
  const mode = document.querySelector<HTMLElement>(home ? '.hero-mode' : '.mode')!
  const pages = new Map<string, ManualPage>(
    (JSON.parse(document.getElementById('manual-pages')?.textContent ?? '[]') as ManualPage[]).map(
      (page) => [page.file, page],
    ),
  )
  const files = new Set(pages.keys())
  const byPath = new Map(
    [...pages.values()].map((page) => [new URL(page.url, location.href).pathname, page.file]),
  )
  const tabs = new Map<string, ReaderDocument>()
  let current = home ? 'hero.ts' : body.dataset.file!
  tabs.set(
    current,
    JSON.parse(document.getElementById('document-paint')!.textContent!) as ReaderDocument,
  )
  const originals = new Map([[current, tabs.get(current)!.text]])
  const updateDirty = () => {
    const path = document.querySelector('.path')
    if (!path) return
    path.querySelector('.dirty')?.remove()
    if ((docs?.text() ?? tabs.get(current)!.text) === originals.get(current)) return
    const label = document.createElement('span')
    label.className = 'dirty'
    label.textContent = ' · Edited'
    label.title = 'Edits stay in this browser tab'
    path.append(label)
  }
  let docs: DocsEditor | null = null
  let mounted: MountedPaintSnapshot | null = null
  let queue = Promise.resolve()
  const button = document.createElement('button')
  button.type = 'button'
  button.disabled = true
  button.textContent = 'Go live'
  mode.replaceChildren(button)
  const setMode = (live: boolean) => {
    body.dataset.mode = live ? 'editor' : 'static'
    if (home) container.dataset.mode = live ? 'editor' : 'static'
    button.textContent = live ? 'Go static' : 'Go live'
  }
  const paint = () => {
    if (docs) return
    const decoded = decodePaintSnapshot(tabs.get(current)![palette()].paint)
    if (!decoded) throw new TypeError(`Invalid document capture for ${current}`)
    const next = mountPaintSnapshot(article, decoded)
    if (!next) throw new TypeError(`Cannot mount document capture for ${current}`)
    mounted?.dispose()
    mounted = next
    article.querySelector('.captured-html')?.dispatchEvent(new Event('dispose-document-paint'))
    article.querySelector('.captured-html')?.remove()
  }
  await document.fonts.load('14px "JetBrains Mono"')
  await document.fonts.ready
  paint()
  setMode(false)
  const install = document.querySelector<HTMLElement>('.install')
  let installPaint: MountedPaintSnapshot | null = null
  const paintInstall = () => {
    if (!install) return
    const capture = JSON.parse(
      document.getElementById('install-paint')!.textContent!,
    ) as ReaderDocument
    const decoded = decodePaintSnapshot(capture[palette()].paint)
    const next = decoded && mountPaintSnapshot(install, decoded)
    if (!next) return
    installPaint?.dispose()
    installPaint = next
    install.querySelector('.captured-html')?.dispatchEvent(new Event('dispose-document-paint'))
    install.querySelector('.captured-html')?.remove()
  }
  paintInstall()

  const capture = async () => {
    if (!docs) return
    const text = docs.text()
    // The unfocused preview is the reading paint. A caret on a mark reveals its source.
    docs.editor.setSelection(text.length, text.length, { reveal: false })
    await frame()
    await document.fonts.ready
    const saved = await docs.capturePaint()
    const chosen = palette()
    const other = chosen === 'light' ? 'dark' : 'light'
    const host = docs.element.parentElement!
    host.style.position = 'absolute'
    host.style.top = '0'
    host.style.opacity = '0'
    article.hidden = false
    const decoded = decodePaintSnapshot(saved.paint)
    const frozen = decoded && mountPaintSnapshot(article, decoded)
    if (!frozen) {
      article.hidden = true
      host.style.position = 'relative'
      host.style.opacity = '1'
      throw new TypeError(`${current}: paint mount refused`)
    }
    mounted?.dispose()
    mounted = frozen
    try {
      host.style.colorScheme = other
      docs.refreshTheme()
      await frame()
      await document.fonts.ready
      const alternate = await docs.capturePaint()
      tabs.set(current, {
        text,
        [chosen]: { ...tabs.get(current)![chosen], paint: saved.paint },
        [other]: { ...tabs.get(current)![other], paint: alternate.paint },
      } as ReaderDocument)
    } catch (error) {
      article.hidden = true
      host.style.position = 'relative'
      host.style.opacity = '1'
      throw error
    } finally {
      host.style.colorScheme = ''
      docs.refreshTheme()
    }
  }

  const goLive = async () => {
    if (docs) return
    const target = current
    const { mountDocsEditor } = await import('./editor')
    const saved = tabs.get(target)!
    const host = document.createElement('div')
    host.className = 'editor-host'
    // Keep the current paint in flow while the admitted snapshot prepares its replacement.
    host.style.position = 'absolute'
    host.style.top = '0'
    host.style.width = '100%'
    host.style.opacity = '0'
    container.append(host)
    let live: DocsEditor | null = null
    try {
      live = mountDocsEditor(host, {
        ...documentOptions(article, target, saved.text),
        snapshot: saved[palette()].paint,
        openLink,
      })
      live.onChange(updateDirty)
      live.editor.setSelection(saved.text.length, saved.text.length, {
        reveal: false,
      })
      live.editor.setPresentationReady(true)
      if (target.endsWith('.md')) await live.ready()
      else await live.highlighted()
      docs = live
      updateDirty()
      host.style.position = 'relative'
      live.editor.setPresentationReady(false)
      host.style.opacity = '1'
      article.hidden = true
      live.editor.setPresentationReady(true)
      setMode(true)
    } catch (error) {
      live?.dispose()
      host.remove()
      throw error
    }
  }
  const goStatic = async () => {
    if (!docs) return
    await capture()
    const host = docs.element.parentElement!
    docs.dispose()
    docs = null
    host.remove()
    article.hidden = false
    setMode(false)
  }
  const run = (operation: () => Promise<void>) => {
    queue = queue.then(async () => {
      const focused = document.activeElement
      button.disabled = true
      try {
        await operation()
      } catch (error) {
        console.error('The editor mode could not change.', error)
      } finally {
        button.disabled = false
        if (focused === button && document.activeElement === body)
          button.focus({ preventScroll: true })
      }
    })
    return queue
  }
  button.addEventListener('click', () => void run(docs ? goStatic : goLive))

  function reveal(hash: string, place = 0) {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    const heading = [...container.querySelectorAll<HTMLElement>('[id]')].find(
      (element) => element.id === id && element.getClientRects().length,
    )
    if (heading) heading.scrollIntoView({ block: 'start' })
    else scrollTo(0, place)
  }
  async function openFile(file: string, push: boolean, hash = '', place = 0) {
    const page = pages.get(file)
    if (!page) return
    const outgoingPlace = scrollY
    const live = Boolean(docs)
    if (file !== current && !tabs.has(file)) {
      const response = await fetch(page.paint)
      if (!response.ok) throw new TypeError(`Cannot load captured page ${file}`)
      const loaded = (await response.json()) as ReaderDocument
      tabs.set(file, loaded)
      originals.set(file, loaded.text)
    }
    if (file !== current) {
      await goStatic()
      current = file
      body.dataset.file = file
      document.title = `${page.title} · Singapore docs`
      const path = document.querySelector('.path')!
      path.textContent = `docs/${file}`
      updateDirty()
      for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-md]')) {
        if (link.dataset.md === file) link.setAttribute('aria-current', 'page')
        else link.removeAttribute('aria-current')
      }
      paint()
      if (live)
        await goLive().catch((error) => {
          console.error('The captured page is ready. Live editing could not start.', error)
        })
    }
    if (push) {
      history.replaceState({ ...history.state, place: outgoingPlace }, '')
      history.pushState({ file, hash }, '', page.url + hash)
    }
    reveal(hash, place)
  }
  function openLink(href: string) {
    const target = resolveDocsLink(current, href, import.meta.env.BASE_URL, files)
    const url = new URL(target.href, location.href)
    const file = target.md ?? byPath.get(url.pathname)
    if (file && url.origin === location.origin) void run(() => openFile(file, true, url.hash))
    else if (url.origin === location.origin) location.href = url.href
    else window.open(url.href, '_blank', 'noopener')
  }
  document.addEventListener('click', (event) => {
    if (
      home ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    )
      return
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!link || link.origin !== location.origin) return
    const file = byPath.get(link.pathname)
    if (!file) return
    event.preventDefault()
    link.closest('dialog')?.close()
    link.closest('details')?.removeAttribute('open')
    void run(() => openFile(file, true, link.hash))
  })
  window.addEventListener('popstate', (event) => {
    const state = event.state as {
      file?: string
      hash?: string
      place?: number
    } | null
    if (state?.file)
      void run(() => openFile(state.file!, false, state.hash ?? location.hash, state.place))
  })
  if (!home) history.replaceState({ file: current, hash: location.hash }, '')
  onThemeChange(() => {
    void run(async () => {
      docs?.refreshTheme()
      await frame()
      await document.fonts.ready
      paint()
      paintInstall()
    })
  })
  let width = container.clientWidth
  new ResizeObserver(() => {
    if (container.clientWidth === width) return
    width = container.clientWidth
    void run(async () => {
      await frame()
      await document.fonts.ready
      paint()
      paintInstall()
    })
  }).observe(container)
  setUpSearch(byPath)
  button.disabled = false
  if (location.hash) reveal(location.hash)
  if (new URLSearchParams(location.search).get('editor') === 'on') void run(goLive)
}
