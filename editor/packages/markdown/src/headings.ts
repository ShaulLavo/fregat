import type {
  EditorInlineReplacementContext,
  EditorRowPresentation,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import { Kind } from 'tree-sitter-md'

export type MarkdownHeadings = {
  readonly source: TextReadSnapshot
  readonly rows: ReadonlyMap<number, number>
}

export function markdownHeadings(context: EditorInlineReplacementContext): MarkdownHeadings {
  const rows = new Map<number, number>()
  const records = context.records?.data
  if (!records) return { source: context.textSnapshot, rows }
  for (let index = 0; index < records.length; index += 4) {
    const level = records[index + 3]!
    if (records[index + 2] !== Kind.Heading || level < 1 || level > 6) continue
    rows.set(context.textSnapshot.lineAt(records[index]!), level)
  }
  return { source: context.textSnapshot, rows }
}

export function headingContribution(
  context: EditorViewContributionContext,
  read: () => MarkdownHeadings | null,
): EditorViewContribution {
  const mounted = new Map<number, EditorRowPresentation>()
  const clear = (index: number, presentation: EditorRowPresentation): void => {
    presentation.element.removeAttribute('role')
    presentation.element.removeAttribute('aria-level')
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
      const level = rows?.get(row.bufferRow)
      if (level === undefined) continue
      const presentation = mount(row.index)
      if (!presentation) continue
      retained.add(row.index)
      const element = presentation.element
      if (element.getAttribute('role') !== 'heading') element.setAttribute('role', 'heading')
      if (element.getAttribute('aria-level') !== String(level))
        element.setAttribute('aria-level', String(level))
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
