/**
 * The single authority for what indentation a new line gets.
 *
 * Auto-close defers to this rather than growing its own rule, so there is one place that decides
 * how a line is indented instead of two that can disagree.
 */

import {
  editorLanguageConfiguration,
  matches,
  onEnterAction,
  type EditorEnterAction,
  type EditorLanguageConfiguration,
} from './languageConfiguration'

export type LineBreakIndent = {
  /** Text inserted at the caret: the newline and the new line's indentation. */
  readonly insert: string
  /**
   * Text inserted *after* the caret, used when a closing delimiter has to be pushed onto its own
   * line. Empty for an ordinary line break.
   */
  readonly trailing: string
}

export type LineBreakIndentOptions = {
  /** Selects the rules to consult; an unregistered language gets the plain copy. */
  readonly languageId: string | null | undefined
  /** The current line's text from its start up to the caret. */
  readonly lineTextBeforeCaret: string
  /** The rest of the current line, from the caret to the line's end. */
  readonly lineTextAfterCaret: string
  /** The whole previous line, or null when the caret is on the first one. */
  readonly previousLineText: string | null
  readonly tabSize: number
}

/**
 * Indentation for a line break.
 *
 * The language's own rules and its delimiters decide first; only when neither recognises the
 * construct does the new line copy the current one's indentation. Deciding it here rather than from
 * the characters flanking the caret is what lets a switch label, a doc-comment leader or an opener
 * with trailing spaces indent at all — none of them has a delimiter next to the caret.
 */
export function lineBreakIndent(options: LineBreakIndentOptions): LineBreakIndent {
  const configuration = editorLanguageConfiguration(options.languageId)
  const action = enterAction(configuration, options)

  const base = trimEnd(leadingWhitespace(options.lineTextBeforeCaret), action?.removeText ?? 0)
  const unit = indentUnit(base, options.tabSize)
  const appendText = action?.appendText ?? ''

  if (action?.indentAction === 'indent') {
    return { insert: `\n${base}${unit}${appendText}`, trailing: '' }
  }
  if (action?.indentAction === 'indentOutdent') {
    return { insert: `\n${base}${action.appendText ?? unit}`, trailing: `\n${base}` }
  }

  return { insert: `\n${base}${appendText}`, trailing: '' }
}

function enterAction(
  configuration: EditorLanguageConfiguration | null,
  options: LineBreakIndentOptions,
): EditorEnterAction | null {
  const decided = onEnterAction(configuration, {
    previousLineText: options.previousLineText,
    textAfter: options.lineTextAfterCaret,
    textBefore: options.lineTextBeforeCaret,
  })
  if (decided) return decided

  // Reached when no delimiter sits at the caret at all, which is the only case the line-shape rules
  // can still answer: `case 'a':` opens a block with a colon.
  const rules = configuration?.indentationRules
  if (!rules || !matches(rules.increaseIndentPattern, options.lineTextBeforeCaret)) return null

  return { indentAction: 'indent' }
}

/** Leading whitespace of a line, which is what a continued line copies verbatim. */
export function leadingWhitespace(lineText: string): string {
  const match = /^[ \t]*/.exec(lineText)
  return match?.[0] ?? ''
}

function trimEnd(indentation: string, count: number): string {
  if (count <= 0) return indentation

  return indentation.slice(0, Math.max(0, indentation.length - count))
}

/**
 * One indent level, inferred from the line rather than configured.
 *
 * A file indented with tabs keeps getting tabs; anything else gets spaces. Inferring beats a
 * setting here because the wrong choice is visible on the very next line.
 */
function indentUnit(base: string, tabSize: number): string {
  if (base.includes('\t')) return '\t'

  return ' '.repeat(Math.max(1, tabSize))
}
