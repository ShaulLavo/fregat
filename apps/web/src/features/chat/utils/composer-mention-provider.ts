import type {
  EditorInlineReplacementContext,
  EditorInlineReplacementProvider,
} from '@singapore-editor/core/extensions'
import type { InlineReplacementRender } from '@singapore-editor/core/rendering'

import { basename } from '@/lib/path-formatters'
import { composerMentionSpans } from '@/features/chat/utils/composer-mentions'

/**
 * Derives the composer's chips from its text on every edit, so paste, draft restore, stash and undo
 * need no chip code of their own. The buffer keeps `@path`; each chip stands over it as one atomic
 * unit the caret steps over and one Backspace removes.
 */
export function createComposerMentionProvider(
  renderChip: (path: string) => InlineReplacementRender,
): EditorInlineReplacementProvider {
  let chipped: ReadonlySet<string> = new Set()

  return (context) => {
    const text = context.textSnapshot.readRange(0, context.textSnapshot.length)
    const spans = composerMentionSpans(text, collapsedCaret(context), chipped)
    chipped = new Set(spans.map((span) => span.key))

    return spans.map((span) => ({
      atomic: true,
      endIndex: span.end,
      id: `mention:${span.key}`,
      key: `mention:${span.key}`,
      render: renderChip(span.path),
      reveal: 'never',
      startIndex: span.start,
      // Stands in for the chip's width until the rendered node is measured.
      text: `${basename(span.path)}   `,
    }))
  }
}

function collapsedCaret(context: EditorInlineReplacementContext) {
  const only = context.selections.length === 1 ? context.selections[0] : undefined
  if (!only || only.startOffset !== only.endOffset) return null

  return only.headOffset
}
