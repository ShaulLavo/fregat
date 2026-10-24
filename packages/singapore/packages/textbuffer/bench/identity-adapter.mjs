import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadIdentityAdapter(root) {
  const api = await import(pathToFileURL(path.join(root, 'index.js')).href)
  const { validatePieceTreeInvariants } = await import(
    pathToFileURL(path.join(root, 'debug.js')).href
  )
  // The author survives restores; allocation and authoring conversion are timed.
  const author = new api.CharIdAllocator('benchmark-author')
  function wrap(snapshot) {
    const apply = (edit) => {
      const left = edit.from === 0 ? 'start' : api.charIdAt(snapshot, edit.from - 1)
      const spans = api.charIdSpansInRange(snapshot, edit.from, edit.to)
      const insert = edit.text.length
        ? {
            start: author.generateAfter(left, edit.text.length),
            text: edit.text,
            at: { after: left },
          }
        : undefined
      snapshot = api.applyCharIdEdit(snapshot, { delete: spans, insert })
    }
    return {
      length: () => snapshot.length,
      lineCount: () => (snapshot.root?.subtreeLineBreaks ?? 0) + 1,
      edit: apply,
      batch(edits) {
        for (const edit of edits.toSorted((a, b) => b.from - a.from || b.to - a.to)) apply(edit)
      },
      line: (row) => api.readPieceTableLine(snapshot, row),
      range: (from, to) => api.readPieceTableTextRange(snapshot, from, to),
      point: (offset) => api.offsetToPoint(snapshot, offset),
      offset: (point) => api.pointToOffset(snapshot, point),
      full: () => api.materializePieceTableFullText(snapshot),
      retain: () => api.retainPieceTableSnapshot(snapshot),
      issues: () => validatePieceTreeInvariants(snapshot).issues,
      stats: () => ({ pieces: snapshot.pieceCount, chunks: snapshot.buffers.chunks.size }),
    }
  }
  return {
    create: (text) =>
      wrap(
        api.createPieceTableSnapshot(text, { charIds: { bunch: 'benchmark-seed:0', counter: 0 } }),
      ),
    restore: wrap,
    retainedText: api.materializePieceTableFullText,
  }
}
