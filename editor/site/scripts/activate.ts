import {
  activatePaintSnapshotHighlights,
  decodePaintSnapshot,
  preparePaintSnapshotHighlights,
} from '@singapore-editor/core/paint'
import type { ReaderDocument } from '../src/manual/captured'

preparePaintSnapshotHighlights(document)

const decoded = new WeakMap<
  HTMLElement,
  { light: ReturnType<typeof decodePaintSnapshot>; dark: ReturnType<typeof decodePaintSnapshot> }
>()

/** Called by a blocking inline script immediately after each emitted root. */
export function activate(root: HTMLElement, payload: HTMLElement, theme: 'light' | 'dark') {
  let paints = decoded.get(payload)
  if (!paints) {
    const capture = JSON.parse(payload.textContent!) as ReaderDocument
    paints = {
      light: decodePaintSnapshot(capture.light.paint),
      dark: decodePaintSnapshot(capture.dark.paint),
    }
    decoded.set(payload, paints)
  }
  const paint = paints[theme]
  const handle = paint && activatePaintSnapshotHighlights(root, paint)
  if (!handle) throw new TypeError('The emitted editor paint could not activate.')
  root
    .closest('.captured-html')!
    .addEventListener('dispose-document-paint', () => handle.dispose(), { once: true })
}
