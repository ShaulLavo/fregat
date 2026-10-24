import type { VirtualizedTextView } from '../../../editor/src/virtualization/virtualizedTextView'
import type { Editor } from '@singapore-editor/core/editor'
import { toEditorTokenStore, type EditorTokenInput } from '@singapore-editor/core/syntax'

export function tokenColors(tokens: EditorTokenInput, text: string): readonly (string | null)[] {
  const length = text.length
  const colors: (string | null)[] = Array.from({ length }, () => null)
  for (const token of toEditorTokenStore(tokens).toTokens()) {
    for (let index = token.start; index < Math.min(length, token.end); index++) {
      if (text[index] === '\n' || text[index] === '\r') continue
      colors[index] = token.style.color ?? null
    }
  }
  return colors
}

/** Reads registered DOM ranges, not the controller's intended token array. */
export function mountedColors(editor: Editor, length: number): readonly (string | null)[] {
  const mounted: VirtualizedTextView = editor['view']
  const view = mounted['view']
  const offsets = new Map<Node, number>()
  const chunks = [...view.rowElements.values()].flatMap((row) => row.chunks)
  for (const chunk of chunks) {
    offsets.set(chunk.textNode, chunk.startOffset)
    for (const part of chunk.parts) {
      if (part.kind === 'text') offsets.set(part.node, chunk.startOffset + part.localStart)
    }
  }
  const colors: (string | null)[] = Array.from({ length }, () => null)
  const registered = new Map(view.highlightRegistry?.entries?.() ?? [])
  const ranges = [...view.rowTokenRanges.values()].flatMap((row) =>
    [...row].flatMap(([key, spans]) => spans.map((range) => ({ key, range }))),
  )
  for (const { key, range } of ranges) {
    const group = view.tokenGroups.get(key)
    if (!group || registered.get(group.name) !== group.highlight || !group.highlight.has(range))
      continue
    const start = offsets.get(range.startContainer)
    const end = offsets.get(range.endContainer)
    if (start === undefined || end === undefined) continue
    for (
      let index = start + range.startOffset;
      index < Math.min(length, end + range.endOffset);
      index++
    )
      colors[index] = group.style.color ?? null
  }
  return colors
}
