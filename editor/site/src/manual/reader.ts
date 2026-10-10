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
  const setMode = (live: boolean) => {
    body.dataset.mode = live ? 'editor' : 'static'
    if (home) container.dataset.mode = live ? 'editor' : 'static'
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

  const takeOver = async () => {
    if (docs) return
    const target = current
    const { mountDocsEditor } = await import('./editor')
    const saved = tabs.get(target)!
    const host = document.createElement('div')
    host.className = 'editor-host'
    host.inert = true
    // Keep the current paint interactive while the admitted snapshot prepares its replacement.
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
      docs.refreshTheme()
      updateDirty()
      host.style.position = 'relative'
      live.editor.setPresentationReady(false)
      host.style.opacity = '1'
      host.inert = false
      article.hidden = true
      live.editor.setPresentationReady(true)
      setMode(true)
    } catch (error) {
      docs = null
      article.hidden = false
      setMode(false)
      live?.dispose()
      host.remove()
      throw error
    }
  }
  const run = (operation: () => Promise<void>) => {
    queue = queue.then(operation).catch((error) => {
      console.error('The live editor could not load.', error)
    })
    return queue
  }

  function reveal(hash: string, place = 0) {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    const heading =
      id === container.id
        ? container
        : Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(
            (element) => element.id === id && element.getClientRects().length,
          )
    if (heading) heading.scrollIntoView({ block: 'start' })
    else scrollTo(0, place)
  }
  async function openFile(file: string, push: boolean, hash = '', place = 0) {
    const page = pages.get(file)
    if (!page || !docs) return
    const outgoingPlace = scrollY
    if (file !== current && !tabs.has(file)) {
      const response = await fetch(page.paint)
      if (!response.ok) throw new TypeError(`Cannot load captured page ${file}`)
      const loaded = (await response.json()) as ReaderDocument
      tabs.set(file, loaded)
      originals.set(file, loaded.text)
    }
    if (file !== current) {
      tabs.set(current, { ...tabs.get(current)!, text: docs.text() })
      current = file
      docs.editor.openDocument({
        documentId: file,
        text: tabs.get(file)!.text,
        languageId: 'markdown',
      })
      docs.editor.setSelection(tabs.get(file)!.text.length, tabs.get(file)!.text.length, {
        reveal: false,
      })
      body.dataset.file = file
      document.title = `${page.title} · Singapore docs`
      const path = document.querySelector('.path')!
      path.textContent = `docs/${file}`
      updateDirty()
      for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-md]')) {
        if (link.dataset.md === file) link.setAttribute('aria-current', 'page')
        else link.removeAttribute('aria-current')
      }
      await docs.ready().catch((error) => {
        console.warn('The page is editable. Syntax preview could not finish.', error)
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
      !docs ||
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
    if (!file || (file === current && link.hash === '#doc')) return
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
    if (state?.file) void run(() => openFile(state.file!, false, location.hash, state.place))
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
  if (location.hash) reveal(location.hash)
  const activate = () => void run(takeOver)
  const idle = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(activate)
      return
    }
    // A task after the frame yields first paint on browsers without an idle callback.
    requestAnimationFrame(() => {
      const task = new MessageChannel()
      task.port1.onmessage = () => {
        task.port1.close()
        task.port2.close()
        activate()
      }
      task.port2.postMessage(null)
    })
  }
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}
