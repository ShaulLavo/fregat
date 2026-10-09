/**
 * The home page sample: static rows first, then the real editor in the same box. Desktop pointers
 * get the editor on idle; phones get it on request.
 */
import type { DocsEditor } from './editor'
import { setUpSearch } from './search'
import { onThemeChange } from './theme-toggle'

const box = document.querySelector<HTMLElement>('.hero-box')!
const mode = document.querySelector<HTMLElement>('.hero-mode')!
const AUTO = matchMedia('(pointer: fine) and (min-width: 761px)')
const forced = new URLSearchParams(location.search).get('editor')
const source = JSON.parse(document.getElementById('hero-source')!.textContent!) as string
let docs: DocsEditor | null = null

async function takeOver() {
  if (docs) return
  mode.textContent = 'Loading editor…'
  const css = getComputedStyle(box)
  const [mountDocsEditor] = await Promise.all([
    import('./editor').then(({ mountDocsEditor }) => mountDocsEditor),
    document.fonts.load(`${css.fontSize} "JetBrains Mono"`),
  ])
  const host = document.createElement('div')
  host.className = 'editor-host'
  host.dataset.state = 'mounting'
  box.append(host)
  docs = mountDocsEditor(host, {
    documentId: 'hero.ts',
    languageId: 'typescript',
    text: source,
    lineHeight: 22,
    fontSize: parseFloat(css.fontSize),
    fontFamily: css.fontFamily,
    gutterWidth: parseFloat(getComputedStyle(document.body).getPropertyValue('--gw')),
    label: 'hero.ts, an editable TypeScript sample',
    openLink: (href) => window.open(href, '_blank', 'noopener'),
    background: 'code-bg',
  })
  docs.editor.setSelection(source.length)
  await docs.highlighted()
  host.dataset.state = 'ready'
  box.dataset.mode = 'editor'
  docs.editor.setPresentationReady(true)
  mode.textContent = ''
}

onThemeChange(() => docs?.refreshTheme())
setUpSearch(new Map())

const start = () =>
  takeOver().catch((error: unknown) => {
    console.error('Singapore editor failed to load; the sample stays static.', error)
    docs?.dispose()
    box.querySelector('.editor-host')?.remove()
    box.removeAttribute('data-mode')
    docs = null
    offer()
  })

function offer() {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Open in editor'
  button.addEventListener('click', () => void start())
  mode.replaceChildren(button)
}

if (forced === 'on' || (forced !== 'off' && AUTO.matches)) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => void start(), { timeout: 300 })
  else setTimeout(() => void start(), 0)
} else {
  offer()
}
