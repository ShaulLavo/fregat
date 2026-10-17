import type { Piece, PieceName } from 'ascii.rest'
import type { Scene } from './scene/scenes'

interface PageData {
  readonly charts: readonly ({
    readonly data: Record<string, number>
    readonly max: number
  } | null)[]
  readonly scores: readonly {
    readonly label: string
    readonly value: number
    readonly ours: boolean
  }[]
}

const TAB_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 }

function json<T>(id: string): T {
  return JSON.parse(document.getElementById(id)!.textContent!) as T
}

const scenes = json<Scene[]>('scenes')
const page = json<PageData>('page-data')
const scene =
  scenes.find((entry) => entry.name === document.documentElement.dataset['scene']) ?? scenes[0]!
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// A slider's reveal: as long as the bar chart's own growth, to its resting frame.
const REVEAL_SECONDS = 1.05

/** Plays `frame(t)` from 0 to `seconds` on animation frames, then holds the last one. */
function play(seconds: number, frame: (t: number) => void) {
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(seconds, (now - start) / 1000)
    frame(t)
    if (t < seconds) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * Plays a slider once, the first time it scrolls into view. One already on screen when the page opens keeps the
 * server's final frame, so nothing runs backwards.
 */
function revealOnce(host: HTMLElement, empty: () => void, reveal: () => void) {
  const observer = new IntersectionObserver(([entry], self) => {
    if (!entry) return
    if (entry.isIntersecting && !host.dataset['armed']) return self.disconnect()
    if (!entry.isIntersecting) {
      if (!host.dataset['armed']) empty()
      host.dataset['armed'] = 'true'
      return
    }
    self.disconnect()
    reveal()
  })
  observer.observe(host)
}

/** The page's ascii.rest pieces in the scene's colours: the wordmark on a canvas, the rest as animated HTML text. */
async function paintArt() {
  const [{ mount }, { chart, score, wordmark, working }, { frameHtml }] = await Promise.all([
    import('ascii.rest'),
    import('./scene/art'),
    import('./scene/ascii-html'),
  ])
  const ink = (_: number, hex: string) => hex
  const drawn = new WeakMap<HTMLElement, string>()
  const draw = (host: HTMLElement, piece: Piece, t: number) => {
    const html = frameHtml(piece, t, ink)
    if (drawn.get(host) === html) return
    drawn.set(host, html)
    host.innerHTML = html
  }

  const banner = document.querySelector<HTMLElement>('[data-art="wordmark"]')
  if (banner) {
    const canvas = document.createElement('canvas')
    banner.replaceChildren(canvas)
    mount(canvas, wordmark(scene.theme), { motion: !reducedMotion })
  }
  if (reducedMotion) return

  for (const host of document.querySelectorAll<HTMLElement>('[data-working]')) {
    const piece = working(scene.theme)
    play(Number.POSITIVE_INFINITY, (t) => draw(host, piece, t))
  }
  for (const host of document.querySelectorAll<HTMLElement>('[data-chart]')) {
    const entry = page.charts[Number(host.dataset['chart'])]
    if (!entry) continue
    const piece = chart(entry.data, entry.max)(scene.theme)
    revealOnce(
      host,
      () => draw(host, piece, 0),
      () => play(piece.meta.still ?? REVEAL_SECONDS, (t) => draw(host, piece, t)),
    )
  }
  for (const host of document.querySelectorAll<HTMLElement>('[data-score]')) {
    const entry = page.scores[Number(host.dataset['score'])]
    if (!entry) continue
    let shown = 0
    const piece = score(entry.label, () => shown, entry.ours)(scene.theme)
    revealOnce(
      host,
      () => draw(host, piece, 0),
      () =>
        play(REVEAL_SECONDS, (t) => {
          // Eases out like the bar chart's growth.
          shown = entry.value * (1 - (1 - t / REVEAL_SECONDS) ** 3)
          draw(host, piece, t)
        }),
    )
  }
}

function wireCopy() {
  const button = document.getElementById('copy-install') as HTMLButtonElement
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText('npm install ghostty-webgpu').then(
      () => true,
      () => false,
    )
    button.textContent = copied ? '[ copied ]' : '[ select it ]'
    setTimeout(() => (button.textContent = '[ copy ]'), 1600)
  })
}

function wireTabs() {
  const list = document.getElementById('bench-tabs')!
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const select = (chosen: HTMLButtonElement) => {
    for (const tab of tabs) {
      const selected = tab === chosen
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !selected
    }
  }
  list.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>('[role="tab"]')
    if (tab) select(tab)
  })
  list.addEventListener('keydown', (event) => {
    const step = TAB_STEPS[event.key]
    if (step === undefined) return
    const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    const next = tabs[(current + step + tabs.length) % tabs.length]!
    select(next)
    next.focus()
  })
}

wireCopy()
wireTabs()
// The scene's terminal and the page's art load side by side; neither waits for the other.
import('./scene/player')
  .then(({ mountScene }) =>
    mountScene(
      document.getElementById('scene')!,
      scene.name as PieceName,
      scene.theme,
      reducedMotion,
    ),
  )
  .catch((cause: unknown) => console.error('The scene did not start', cause))
paintArt().catch((cause: unknown) => console.error('The page art did not draw', cause))
