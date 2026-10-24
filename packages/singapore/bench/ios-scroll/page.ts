import { Editor } from '@singapore-editor/core/editor'
import { createLineGutterPlugin } from '@singapore-editor/gutters'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'
import './probe.css'
import { geometrySample, summarize } from './metrics.mjs'

declare const __PROBE_COMMIT__: string
const params = new URLSearchParams(location.search)
const form = document.querySelector<HTMLFormElement>('#settings')!
for (const select of form.querySelectorAll<HTMLSelectElement>('select')) {
  const value = params.get(select.name)
  if (value && [...select.options].some((option) => option.value === value)) select.value = value
}
const settings = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
const host = document.querySelector<HTMLElement>('#editor')!
host.dataset.paint = settings.paint
host.dataset.gutter = settings.gutter
host.dataset.anchor = settings.anchor
const editor = new Editor(host, {
  lineHeight: 20,
  fontSize: 13,
  readOnly: true,
  rowPositioning: settings.position === 'top' ? 'top' : 'transform',
  plugins: [createLineGutterPlugin()],
})
editor.setText(
  Array.from(
    { length: 10000 },
    (_, index) => `${String(index + 1).padStart(5, '0')}  const row = ${index}; // scroll probe`,
  ).join('\n'),
)
const scroller = host.querySelector<HTMLElement>('.editor-virtualized')!
// Singapore shadows scrollTop with its logical snapshot. Read the browser's native getter.
const readNativeScrollTop = () => Reflect.get(Element.prototype, 'scrollTop', scroller) as number
const status = document.querySelector<HTMLElement>('#status')!
const startButton = document.querySelector<HTMLButtonElement>('#start')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!
const scriptButton = document.querySelector<HTMLButtonElement>('#scripted')!
const summary = document.querySelector<HTMLElement>('#summary')!
const json = document.querySelector<HTMLTextAreaElement>('#json')!
const note = document.querySelector<HTMLInputElement>('#note')!
const storageKey = 'singapore-ios-scroll-runs-v1'
let runs: any[] = []
try {
  runs = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')
} catch {
  /* A run still downloads when browser storage is unavailable. */
}
let run: any = null
let frameId = 0
let timeoutId = 0
let previousFrame = 0
let previousTop = 0
let lastEventTime = 0
let lastEventTop = 0
let lastTouchEnd = 0
let touching = false
let nextStatusTime = 0
let scriptedStarted = 0
let scriptedPrevious = 0
let observer: PerformanceObserver | null = null

function updateJson() {
  json.value = JSON.stringify({ schema: 1, runs }, null, 2)
}
updateJson()
function sample(timestamp: number) {
  if (!run) return
  const began = performance.now()
  const top = readNativeScrollTop()
  const dt = previousFrame ? timestamp - previousFrame : 0
  const moving = Math.abs(top - previousTop) > 0.01 || touching || timestamp - lastEventTime < 120
  let geometry: any = {
    lagPx: null,
    blankPx: null,
    apparentScrollTop: null,
    firstIndex: null,
    lastIndex: null,
  }
  let rowCount: number | null = null
  let gutterErrorPx: number | null = null
  if (settings.geometry === 'on') {
    const rows = [...host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')].filter(
      (row) => !row.hidden,
    )
    rowCount = rows.length
    const ordered = rows.sort(
      (a, b) => Number(a.dataset.editorVirtualRow) - Number(b.dataset.editorVirtualRow),
    )
    const first = ordered[0]
    const last = ordered.at(-1)
    const viewport = scroller.getBoundingClientRect()
    if (first && last) {
      const firstRect = first.getBoundingClientRect()
      geometry = geometrySample({
        firstIndex: Number(first.dataset.editorVirtualRow),
        lastIndex: Number(last.dataset.editorVirtualRow),
        firstTop: firstRect.top,
        lastBottom: last.getBoundingClientRect().bottom,
        viewportTop: viewport.top + scroller.clientTop,
        viewportHeight: scroller.clientHeight,
        scrollTop: top,
        rowHeight: 20,
      })
      const gutter = host.querySelector<HTMLElement>(
        `[data-editor-virtual-gutter-row="${first.dataset.editorVirtualRow}"]`,
      )
      if (gutter) gutterErrorPx = gutter.getBoundingClientRect().top - firstRect.top
    } else {
      geometry.blankPx = scroller.clientHeight
    }
  }
  run.frames.push({
    t: timestamp - run.startedAt,
    dt,
    scrollTop: top,
    logicalScrollTop: scroller.scrollTop,
    delta: top - previousTop,
    eventAgeMs: lastEventTime ? timestamp - lastEventTime : null,
    eventScrollTop: lastEventTop,
    moving,
    phase: touching ? 'touch' : timestamp - lastTouchEnd < 2000 ? 'after-touch' : run.kind,
    rowCount,
    gutterErrorPx,
    ...geometry,
    measurementCostMs: performance.now() - began,
  })
  previousFrame = timestamp
  previousTop = top
  if (timestamp > nextStatusTime) {
    status.textContent = `Recording ${((timestamp - run.startedAt) / 1000).toFixed(1)} s · ${run.events.length} scroll events · ${run.frames.length} frames`
    nextStatusTime = timestamp + 1000
  }
  if (run.kind === 'scripted') {
    const elapsed = timestamp - scriptedStarted
    if (elapsed >= 8000) {
      void stop()
      return
    }
    const seconds = Math.min(timestamp - scriptedPrevious, 50) / 1000
    scroller.scrollBy(0, (elapsed < 4000 ? 1 : -1) * 1600 * seconds)
    scriptedPrevious = timestamp
  }
  frameId = requestAnimationFrame(sample)
}
function start(kind = 'manual') {
  if (run) return
  note.value = ''
  previousFrame = 0
  previousTop = readNativeScrollTop()
  lastEventTime = 0
  lastEventTop = previousTop
  lastTouchEnd = 0
  scriptedStarted = performance.now()
  scriptedPrevious = scriptedStarted
  run = {
    schema: 1,
    id: crypto.randomUUID(),
    kind,
    date: new Date().toISOString(),
    startedAt: performance.now(),
    commit: __PROBE_COMMIT__,
    settings,
    document: { rows: 10000, rowHeight: 20, wrapped: false, highlighted: false },
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollportHeight: scroller.clientHeight,
      scrollportWidth: scroller.clientWidth,
      visualViewport: visualViewport
        ? {
            width: visualViewport.width,
            height: visualViewport.height,
            scale: visualViewport.scale,
          }
        : null,
    },
    longTasksSupported: PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false,
    longTasks: [],
    events: [],
    frames: [],
    touches: [],
    errors: [],
  }
  if (run.longTasksSupported) {
    observer = new PerformanceObserver((list) => {
      if (run)
        run.longTasks.push(
          ...list
            .getEntries()
            .map((entry) => ({ t: entry.startTime - run.startedAt, duration: entry.duration })),
        )
    })
    observer.observe({ entryTypes: ['longtask'] })
  }
  startButton.disabled = true
  scriptButton.disabled = true
  stopButton.disabled = false
  for (const control of form.elements) (control as HTMLInputElement).disabled = true
  frameId = requestAnimationFrame(sample)
  timeoutId = window.setTimeout(() => {
    void stop()
  }, 60000)
}
async function stop() {
  if (!run) return
  cancelAnimationFrame(frameId)
  clearTimeout(timeoutId)
  observer?.disconnect()
  observer = null
  const completed = run
  run = null
  completed.durationMs = performance.now() - completed.startedAt
  completed.note = note.value
  completed.summary = summarize(completed)
  runs.push(completed)
  let stored = true
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(runs))
  } catch {
    stored = false
  }
  summary.textContent = JSON.stringify(completed.summary, null, 2)
  updateJson()
  startButton.disabled = false
  scriptButton.disabled = false
  stopButton.disabled = true
  for (const control of form.elements) (control as HTMLInputElement).disabled = false
  status.textContent = stored
    ? `Saved ${runs.length} run${runs.length === 1 ? '' : 's'} in this tab.`
    : 'Browser storage is full. Download JSON before changing settings.'
  try {
    const response = await fetch('./api/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(completed),
    })
    if (!response.ok) {
      document.querySelector('#collection')!.textContent =
        'Collector unavailable. Copy or download JSON to share this run.'
      return
    }
    document.querySelector('#collection')!.textContent =
      'Collector saved this run. Copy and download also keep every run in this tab.'
  } catch {
    document.querySelector('#collection')!.textContent =
      'Collector unavailable. Copy or download JSON to share this run.'
  }
}
scroller.addEventListener(
  'scroll',
  (event) => {
    const now = performance.now()
    const top = readNativeScrollTop()
    if (run)
      run.events.push({
        t: now - run.startedAt,
        timestamp: event.timeStamp,
        dispatchAgeMs: now - event.timeStamp,
        delta: top - lastEventTop,
        scrollTop: top,
        gapMs: lastEventTime ? now - lastEventTime : null,
      })
    lastEventTime = now
    lastEventTop = top
  },
  { passive: true },
)
for (const name of ['touchstart', 'touchend', 'touchcancel'] as const) {
  scroller.addEventListener(
    name,
    (event) => {
      touching = name === 'touchstart'
      if (!touching) lastTouchEnd = performance.now()
      if (run)
        run.touches.push({
          type: name,
          t: performance.now() - run.startedAt,
          trusted: event.isTrusted,
        })
    },
    { passive: true },
  )
}
window.addEventListener('error', (event) => {
  if (run) run.errors.push({ t: performance.now() - run.startedAt, message: event.message })
})
form.addEventListener('submit', (event) => {
  event.preventDefault()
  const next = new URLSearchParams(new FormData(form) as any)
  location.search = next.toString()
})
startButton.addEventListener('click', () => start())
stopButton.addEventListener('click', () => {
  void stop()
})
scriptButton.addEventListener('click', () => start('scripted'))
note.addEventListener('change', () => {
  const latest = runs.at(-1)
  if (!latest) return
  latest.note = note.value
  updateJson()
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(runs))
  } catch {
    /* Downloads preserve the note. */
  }
})
document.querySelector('#copy')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(json.value)
    status.textContent = 'Copied all runs.'
  } catch {
    json.closest('details')!.open = true
    json.focus()
    json.select()
    status.textContent = 'Select and copy the JSON below.'
  }
})
document.querySelector('#download')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([json.value], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `singapore-scroll-${new Date().toISOString().replaceAll(':', '-')}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
})
status.textContent = `Ready · ${settings.overscan} overscan rows · ${settings.paint} paint · ${__PROBE_COMMIT__.slice(0, 9)}`
if (params.get('auto') === '1') window.setTimeout(() => start('scripted'), 3000)
// Browser verification can read completed runs without depending on the on-screen summary.
Object.assign(window, {
  scrollProbe: { getRuns: () => runs, start, stop, scroller, readNativeScrollTop },
})
window.addEventListener('pagehide', () => {
  if (run) void stop()
  editor.dispose()
})
