import type { ExampleEditor } from './example-editor'
import type { ExampleCapture } from './examples'
import runtimeUrl from 'virtual:example-editor-url'
import { onThemeChange } from './theme-toggle'

type Source = ExampleCapture & { text: string; language: string }
const states = new Map<
  HTMLElement,
  { ready: Promise<ExampleEditor>; host: HTMLElement; editor?: ExampleEditor }
>()
let runtime: Promise<typeof import('./example-editor')> | undefined
let failedLoads = 0
const load = () => {
  if (runtime) return runtime
  const url = failedLoads ? `${runtimeUrl}?retry=${failedLoads}` : runtimeUrl
  const request = import(/* @vite-ignore */ url) as Promise<typeof import('./example-editor')>
  runtime = Promise.all([import('./example-styles'), request])
    .then(([, editor]) => editor)
    .catch((error: unknown) => {
      runtime = undefined
      failedLoads++
      throw error
    })
  return runtime
}
function prepare(example: HTMLElement) {
  const previous = states.get(example)
  if (previous) return previous
  const source = JSON.parse(example.querySelector('[data-example-source]')!.textContent!) as Source
  const stage = example.querySelector<HTMLElement>('.example-stage')!
  const host = document.createElement('div')
  host.className = 'example-prepared'
  host.inert = true
  stage.append(host)
  const state: { ready: Promise<ExampleEditor>; host: HTMLElement; editor?: ExampleEditor } = {
    host,
    ready: load().then(async ({ mountExample }) => {
      await document.fonts.load('14px "JetBrains Mono"')
      const theme = example.querySelector<HTMLElement>('[data-example-theme="dark"]')!
      const dark = getComputedStyle(theme).display !== 'none'
      const editor = mountExample(host, {
        text: source.text,
        language: source.language,
        label: `${source.language || 'Text'} example editor`,
        snapshot: source[dark ? 'dark' : 'light'].paint,
      })
      state.editor = editor
      await editor.ready()
      example.dataset.exampleReady = ''
      return editor
    }),
  }
  states.set(example, state)
  // A failed idle preparation is retried on a deliberate request.
  void state.ready.catch(() => {
    state.editor?.dispose()
    host.remove()
    states.delete(example)
  })
  return state
}
function reveal(example: HTMLElement, editor: ExampleEditor, focus: boolean) {
  const y = window.scrollY
  example.dataset.exampleLive = ''
  states.get(example)!.host.inert = false
  editor.editor.setPresentationReady(false)
  editor.editor.setPresentationReady(true)
  if (!focus) return
  editor.editor.setSelection(0, 0, { reveal: false })
  editor.element.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  window.scrollTo({ top: y, behavior: 'instant' })
}
const examples = Array.from(document.querySelectorAll<HTMLElement>('[data-example]'))
for (const [index, example] of examples.entries()) {
  const button = example.querySelector<HTMLButtonElement>('.make-live')!
  button.hidden = false
  button.setAttribute(
    'aria-label',
    `Edit ${example.getAttribute('aria-label')}, example ${index + 1}`,
  )
  button.addEventListener('click', async () => {
    const status = example.querySelector<HTMLElement>('.example-status')!
    if (button.getAttribute('aria-disabled') === 'true') return
    button.setAttribute('aria-disabled', 'true')
    const alreadyReady = example.hasAttribute('data-example-ready')
    if (!alreadyReady) {
      button.focus({ preventScroll: true })
      status.textContent = 'Preparing editor…'
    }
    try {
      const editor = await prepare(example).ready
      reveal(example, editor, true)
      button.hidden = true
      status.textContent = 'Editable example'
    } catch (error) {
      console.error('Example preparation failed', error)
      status.textContent = 'Editor could not load. Try again.'
      button.removeAttribute('aria-disabled')
    }
  })
}
const idle = () => {
  void load().catch(() => {})
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const example = entry.target as HTMLElement
        const state = prepare(example)
        if (
          example.hasAttribute('data-home-example') &&
          matchMedia('(pointer: fine) and (min-width: 761px)').matches &&
          new URLSearchParams(location.search).get('editor') !== 'off'
        ) {
          void state.ready
            .then((editor) => {
              reveal(example, editor, false)
              example.querySelector<HTMLButtonElement>('.make-live')!.hidden = true
            })
            .catch(() => {})
        }
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '600px' },
  )
  for (const example of examples) observer.observe(example)
}
if (examples.length > 0) {
  if ('requestIdleCallback' in window) requestIdleCallback(idle)
  else setTimeout(idle, 0)
}
onThemeChange(() => {
  for (const state of states.values()) state.editor?.refreshTheme()
})
