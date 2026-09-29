import type { BracketInfo } from '@singapore-editor/core/syntax'
import { collectBracketLevels } from '@singapore-editor/core/editor'
import {
  editorColorReference,
  firstEditorColor,
  registerEditorColor,
  type VirtualizedTextHighlightStyle,
} from '@singapore-editor/core/rendering'
import type {
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'

export type BracketColorsPluginOptions = {
  readonly enabled?: boolean
  /** Deepest nesting painted; anything nested deeper keeps the colour the grammar gave it. */
  readonly maxLevel?: number
  /** A document with more brackets than this is left uncoloured. */
  readonly maxBrackets?: number
}

type ResolvedBracketColorsOptions = {
  readonly enabled: boolean
  readonly maxLevel: number
  readonly maxBrackets: number
}

type BracketColorRange = {
  readonly start: number
  readonly end: number
}

type BracketColorRanges = {
  /** One bucket per level colour, in palette order. */
  readonly levels: readonly (readonly BracketColorRange[])[]
  readonly unexpected: readonly BracketColorRange[]
}

type BracketLevelPaint = {
  readonly name: string
  readonly style: VirtualizedTextHighlightStyle
}

/**
 * Where depth colouring sits in the shared highlight priority band.
 *
 * A level colour has to replace the one the grammar gave the bracket, and the grammar reaches that
 * same glyph through the same painting mechanism at the default rank: left equal, which of the two
 * wins would come down to the order the two happened to register in.
 *
 * Exported because the band is one document-global namespace shared across packages, and this is
 * the fifth producer to declare a `color` in it. It sat on the semantic token layer's number until
 * the band was renumbered — a tie no one had noticed because no semantic scope covers a bracket
 * glyph today, which makes it the kind of thing that surfaces the first time a host writes a
 * `scopeAliases` entry mapping a server's `brace` onto `operator`.
 */
export const BRACKET_COLOR_Z_INDEX = 1

/*
 * Depth is painted with registered colour ids, so a theme restyles nesting the way it restyles
 * anything else, and each level leans on a syntax colour the theme has already picked rather than on
 * a palette of its own: those hues are distinguishable from one another because the theme had to make
 * them distinguishable to be readable at all, and they follow a theme this file has never heard of. A
 * theme that names none of them leaves the declaration invalid, which drops it and leaves the bracket
 * the colour it already had — the honest outcome for a palette nobody supplied.
 */
const BRACKET_LEVEL_STYLES: readonly VirtualizedTextHighlightStyle[] = [
  'syntax.type',
  'syntax.keyword',
  'syntax.string',
  'syntax.number',
  'syntax.function',
  'syntax.variableBuiltin',
].map((syntaxColorId, level) => ({
  color: bracketLevelColor(level, syntaxColorId),
  zIndex: BRACKET_COLOR_Z_INDEX,
}))

// A closer with nothing to close is a mistake rather than a depth, so it is the one bracket that does
// not take part in the rotation. Nothing in the syntax palette is reliably an error colour to derive
// it from, and the two canvases need different cuts of red to stay legible.
const BRACKET_UNEXPECTED_STYLE: VirtualizedTextHighlightStyle = {
  color: registerEditorColor('brackets.unexpected', { dark: '#f87171', light: '#dc2626' }),
  zIndex: BRACKET_COLOR_Z_INDEX,
}

const DEFAULT_MAX_LEVEL = 200
// Past this the pass and the ranges it produces cost more than the affordance is worth, and painting
// only the part of the file that fit would read as brackets losing their colour halfway down.
const DEFAULT_MAX_BRACKETS = 20_000

/**
 * Colours bracket characters by the nesting depth of the pair they belong to, rotating through the
 * registered level palette.
 *
 * Off until a host installs it: the affordance divides opinion, and it overrides the grammar's own
 * colouring of those characters. Depth comes from the structural parse, so brackets inside strings
 * and comments are not part of the nesting and nothing is painted before a parse has covered the
 * document — a plausible-looking wrong depth is worse here than no colour at all.
 */
export function createBracketColorsPlugin(options: BracketColorsPluginOptions = {}): EditorPlugin {
  const resolved = resolveBracketColorsOptions(options)

  return {
    name: 'bracket-colors',
    activate(context) {
      return context.registerViewContribution({
        createContribution: (contributionContext) =>
          createBracketColorsContribution(contributionContext, resolved),
      })
    },
  }
}

function createBracketColorsContribution(
  context: EditorViewContributionContext,
  options: ResolvedBracketColorsOptions,
): EditorViewContribution | null {
  if (!options.enabled) return null
  return new BracketColorsContribution(context, options)
}

class BracketColorsContribution implements EditorViewContribution {
  private readonly context: EditorViewContributionContext
  private readonly options: ResolvedBracketColorsOptions
  private readonly levelPaints: readonly BracketLevelPaint[]
  private readonly unexpectedName: string
  private painted: readonly BracketInfo[] | null = null

  public constructor(
    context: EditorViewContributionContext,
    options: ResolvedBracketColorsOptions,
  ) {
    this.context = context
    this.options = options
    const prefix = context.highlightPrefix
    this.levelPaints = BRACKET_LEVEL_STYLES.map((style, level) => ({
      name: `${prefix}-bracket-level-${level}`,
      style,
    }))
    this.unexpectedName = `${prefix}-bracket-unexpected`
    this.update(context.getSnapshot(), 'document')
  }

  // Every kind is considered rather than a chosen few: a parse that finishes between notifications
  // reaches the first update published after it, whichever kind that happens to be, and a bracket
  // list that only shows up on a scroll would otherwise stay unpainted until the next keystroke.
  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'clear') {
      this.clear()
      return
    }

    this.paint(snapshot)
  }

  public dispose(): void {
    this.clear()
  }

  // A parse replaces the bracket list wholesale and every snapshot until the next one shares it, so
  // its identity is the cheapest honest answer to 'has anything moved'.
  private paint(snapshot: EditorViewSnapshot): void {
    if (this.painted === snapshot.brackets) return

    this.painted = snapshot.brackets
    const ranges = bracketColorRanges(snapshot.brackets, this.options)
    this.levelPaints.forEach((paint, level) => {
      this.setHighlight(paint.name, ranges.levels[level] ?? [], paint.style)
    })
    this.setHighlight(this.unexpectedName, ranges.unexpected, BRACKET_UNEXPECTED_STYLE)
  }

  private clear(): void {
    this.painted = null
    for (const paint of this.levelPaints) this.context.clearRangeHighlight(paint.name)
    this.context.clearRangeHighlight(this.unexpectedName)
  }

  private setHighlight(
    name: string,
    ranges: readonly BracketColorRange[],
    style: VirtualizedTextHighlightStyle,
  ): void {
    this.context.setRangeHighlight(name, ranges, style)
  }
}

function bracketColorRanges(
  brackets: readonly BracketInfo[],
  options: ResolvedBracketColorsOptions,
): BracketColorRanges {
  const levels: BracketColorRange[][] = BRACKET_LEVEL_STYLES.map(() => [])
  const unexpected: BracketColorRange[] = []
  if (brackets.length > options.maxBrackets) return { levels, unexpected }

  for (const bracket of collectBracketLevels(brackets, { maxLevel: options.maxLevel })) {
    const range = { start: bracket.offset, end: bracket.offset + bracket.char.length }
    if (bracket.unexpected) {
      unexpected.push(range)
      continue
    }

    levels[bracket.level % levels.length]?.push(range)
  }

  return { levels, unexpected }
}

function resolveBracketColorsOptions(
  options: BracketColorsPluginOptions,
): ResolvedBracketColorsOptions {
  return {
    enabled: options.enabled ?? true,
    maxLevel: normalizeBracketColorsLimit(options.maxLevel, DEFAULT_MAX_LEVEL),
    maxBrackets: normalizeBracketColorsLimit(options.maxBrackets, DEFAULT_MAX_BRACKETS),
  }
}

function normalizeBracketColorsLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function bracketLevelColor(level: number, syntaxColorId: string): string {
  return registerEditorColor(
    `brackets.level${level}`,
    firstEditorColor(editorColorReference(syntaxColorId), editorColorReference('syntax.bracket')),
  )
}
