import type {
  EditorPlugin,
  EditorInlineReplacementContext,
} from '@singapore-editor/core/extensions'
import { markdownInlineReplacements } from './replacements'
import type { MarkdownLinkOptions } from './linkRender'
import { headingContribution, markdownHeadings, type MarkdownHeadings } from './headings'
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
    activate(context) {
      let headings: MarkdownHeadings | null = null
      let records: Uint32Array | undefined
      const provide = (replacementContext: EditorInlineReplacementContext) => {
        if (!appliesToContext(replacementContext, languageIds) || !replacementContext.records) {
          headings = null
          records = undefined
          return []
        }
        const replacements = markdownInlineReplacements(
          replacementContext.textSnapshot,
          replacementContext.records.data,
          {
            ...options,
            registerKeymapNode: replacementContext.registerKeymapNode,
          },
        )
        if (
          headings?.source !== replacementContext.textSnapshot ||
          records !== replacementContext.records.data
        ) {
          headings = markdownHeadings(replacementContext, replacements)
          records = replacementContext.records.data
        }
        return replacements
      }
      return [
        context.registerInlineReplacementProvider(provide, {
          trigger: 'edit',
          requiresSyntax: true,
        }),
        context.registerViewContribution({
          createContribution: (view) => headingContribution(view, () => headings),
        }),
      ]
    },
  }
}

function appliesToContext(
  context: EditorInlineReplacementContext,
  languageIds: ReadonlySet<string>,
): boolean {
  return (
    context.languageId !== null &&
    languageIds.has(context.languageId) &&
    context.records?.languageId === context.languageId
  )
}
