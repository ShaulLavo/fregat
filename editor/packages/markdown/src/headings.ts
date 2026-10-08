import type {
  EditorInlineReplacementContext,
  EditorRowPresentation,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'
import { Kind } from 'tree-sitter-md'

export type MarkdownHeadings = {
  readonly source: TextReadSnapshot
  readonly rows: ReadonlyMap<number, { readonly level: number; readonly name: string }>
}

export function markdownHeadings(
  context: EditorInlineReplacementContext,
  replacements: readonly InlineReplacementSpec[],
): MarkdownHeadings {
  const rows = new Map<number, { readonly level: number; readonly name: string }>()
  const records = context.records?.data
  if (!records) return { source: context.textSnapshot, rows }
  for (let index = 0; index < records.length; index += 4) {
    const level = records[index + 3]!
    if (records[index + 2] !== Kind.Heading || level < 1 || level > 6) continue
    const start = records[index]!
    const end = records[index + 1]!
    const name = headingName(context.textSnapshot, replacements, start, end)
    rows.set(context.textSnapshot.lineAt(start), { level, name })
  }
  return { source: context.textSnapshot, rows }
}

function headingName(
  source: TextReadSnapshot,
  replacements: readonly InlineReplacementSpec[],
  start: number,
  end: number,
): string {
  let text = source.readRange(start, end)
  const contained = replacements.filter((spec) => spec.startIndex >= start && spec.endIndex <= end)
  for (const spec of contained.sort((a, b) => b.startIndex - a.startIndex)) {
    text = text.slice(0, spec.startIndex - start) + spec.text + text.slice(spec.endIndex - start)
  }
  return text.replace(/\s+/g, ' ').trim()
}

export function headingContribution(
  context: EditorViewContributionContext,
  read: () => MarkdownHeadings | null,
): EditorViewContribution {
  const mounted = new Map<number, EditorRowPresentation>()
  const clear = (index: number, presentation: EditorRowPresentation): void => {
    presentation.element.removeAttribute('role')
    presentation.element.removeAttribute('aria-level')
    presentation.element.removeAttribute('aria-label')
    presentation.dispose()
    mounted.delete(index)
  }
  const mount = (index: number): EditorRowPresentation | null => {
    const existing = mounted.get(index)
    if (existing) return existing
    const presentation = context.getRowPresentation(index)
    if (!presentation) return null
    mounted.set(index, presentation)
    presentation.signal.addEventListener('abort', () => clear(index, presentation), { once: true })
    return presentation
  }
  const update = (snapshot: EditorViewSnapshot): void => {
    const headings = read()
    const rows = headings?.source === snapshot.textSnapshot ? headings.rows : null
    const retained = new Set<number>()
    for (const row of snapshot.visibleRows) {
      if (!row.primaryText || !row.firstWrapSegment) continue
      const heading = rows?.get(row.bufferRow)
      if (!heading) continue
      const presentation = mount(row.index)
      if (!presentation) continue
      retained.add(row.index)
      const element = presentation.element
      if (element.getAttribute('role') !== 'heading') element.setAttribute('role', 'heading')
      if (element.getAttribute('aria-level') !== String(heading.level))
        element.setAttribute('aria-level', String(heading.level))
      if (element.getAttribute('aria-label') !== heading.name)
        element.setAttribute('aria-label', heading.name)
    }
    for (const [index, presentation] of mounted) {
      if (!retained.has(index)) clear(index, presentation)
    }
  }
  return {
    inputs: ['content', 'tokens', 'viewport', 'layout'],
    update,
    dispose() {
      for (const [index, presentation] of mounted) clear(index, presentation)
    },
  }
}
