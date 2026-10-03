import type {
  EditorPlugin,
  EditorInlineReplacementContext,
} from '@singapore-editor/core/extensions'
import type { InlineReplacementSpec } from '@singapore-editor/core/rendering'
import { markdownInlineReplacements } from './replacements'
import type { MarkdownLinkOptions } from './linkRender'
import './style.css'

export { markdownInlineReplacements } from './replacements'
export { createMarkdownAuthoringPlugin } from './authoringPlugin'

export type MarkdownPreviewPluginOptions = MarkdownLinkOptions & {
  /** Language ids this applies to. Defaults to markdown only, so other files render as source. */
  readonly languageIds?: readonly string[]
}

const DEFAULT_LANGUAGE_IDS = ['markdown']

/**
 * Renders markdown as formatted text while the buffer keeps holding markdown source: fences hide,
 * headings drop their `#`, and the source under the caret comes back so it stays editable as text.
 * Links keep their targets on rendered anchors; pipe tables preserve their source column widths.
 */
export function createMarkdownPreviewPlugin(
  options: MarkdownPreviewPluginOptions = {},
): EditorPlugin {
  const languageIds = new Set(options.languageIds ?? DEFAULT_LANGUAGE_IDS)

  return {
    name: 'markdown-preview',
    activate: (context) =>
      context.registerInlineReplacementProvider(
        (replacementContext) => replacementsForContext(replacementContext, languageIds, options),
        { trigger: 'edit', requiresSyntax: true },
      ),
  }
}

const replacementsForContext = (
  context: EditorInlineReplacementContext,
  languageIds: ReadonlySet<string>,
  options: MarkdownLinkOptions,
): readonly InlineReplacementSpec[] => {
  if (context.languageId === null) return []
  if (!languageIds.has(context.languageId)) return []
  if (context.records?.languageId !== context.languageId) return []
  return markdownInlineReplacements(context.textSnapshot, context.records.data, {
    ...options,
    registerKeymapNode: context.registerKeymapNode,
  })
}
