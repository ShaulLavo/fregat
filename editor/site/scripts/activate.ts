import {
  activatePaintSnapshotHighlights,
  decodePaintSnapshot,
  preparePaintSnapshotHighlights,
} from '@singapore-editor/core/paint'
preparePaintSnapshotHighlights(document)
export function activate(root: HTMLElement, encoded: string) {
  const paint = decodePaintSnapshot(encoded)
  if (!paint) throw new TypeError('Invalid example paint')
  for (const row of root.querySelectorAll('[data-editor-document-paint-row]'))
    row.replaceChildren(document.createTextNode(row.textContent ?? ''))
  activatePaintSnapshotHighlights(root, paint)
}
