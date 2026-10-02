import { afterAll, beforeAll } from 'vitest'

interface BrowserFileSnapshot {
  readonly file: string
  readonly phase: 'before' | 'after'
  readonly iframe: ReturnType<typeof documentSnapshot>
  readonly page: ReturnType<typeof documentSnapshot>
}

type DiagnosticWindow = Window & {
  ghosttyBrowserFileHistory?: BrowserFileSnapshot[]
}

function documentSnapshot(document: Document) {
  const faces: { family: string; status: string; weight: string; style: string }[] = []
  document.fonts.forEach((face) => {
    faces.push({ family: face.family, status: face.status, weight: face.weight, style: face.style })
  })
  const view = document.defaultView!
  return {
    width: view.innerWidth,
    height: view.innerHeight,
    pixelRatio: view.devicePixelRatio,
    fonts: { status: document.fonts.status, faces },
  }
}

function recordFile(file: string, phase: 'before' | 'after') {
  const page = window.top as DiagnosticWindow
  const history = (page.ghosttyBrowserFileHistory ??= [])
  history.push({
    file,
    phase,
    iframe: documentSnapshot(document),
    page: documentSnapshot(page.document),
  })
}

// oxlint-disable-next-line no-empty-pattern -- Vitest requires destructured fixture bindings.
beforeAll(({}, suite) => recordFile(suite.file.filepath, 'before'))
// oxlint-disable-next-line no-empty-pattern -- Vitest requires destructured fixture bindings.
afterAll(({}, suite) => recordFile(suite.file.filepath, 'after'))
