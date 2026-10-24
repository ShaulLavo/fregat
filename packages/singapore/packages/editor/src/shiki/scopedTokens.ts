import type { HighlighterGeneric, ThemedToken } from 'shiki/core'
import { Theme, type StateStack } from 'shiki/textmate'
import type { TokenizeLineFn, StatesEqualFn } from './tokenizer'
import { ScopePath } from './scopePath'

type ScopeStyle = { path: ScopePath | null; color: string; fontStyle: number }

class GrammarLineState {
  constructor(readonly stack: StateStack) {}
}

/** Keep grammar scopes independent of colors so a theme change never reparses text. */
export function createScopedLineTokenizer(
  highlighter: Pick<HighlighterGeneric<string, string>, 'getLanguage' | 'getTheme'>,
  language: string,
  initialTheme: string,
  maxLineLength: number,
): { tokenize: TokenizeLineFn; statesEqual: StatesEqualFn; setTheme: (name: string) => void } {
  const grammar = highlighter.getLanguage(language)
  const styles = new Map<string, ScopeStyle>()
  let theme = Theme.createFromRawTheme(highlighter.getTheme(initialTheme))

  const styleFor = (scopes: string[]): ScopeStyle => {
    const key = scopes.join('\u0000')
    const existing = styles.get(key)
    if (existing) return existing

    let path: ScopePath | null = null
    for (const scope of scopes) path = new ScopePath(path, scope)
    const style = { path, color: '', fontStyle: 0 }
    applyTheme(style, theme)
    styles.set(key, style)
    return style
  }

  const tokenize: TokenizeLineFn = (line, previousState) => {
    const state = previousState instanceof GrammarLineState ? previousState.stack : null
    if (!line) return { tokens: [], state: previousState }
    // Grammars have no time bound here, so an oversized line stays one plain token and the
    // grammar state passes through unchanged for the next line.
    if (line.length > maxLineLength)
      return {
        tokens: [scopedToken(line, 0, line.length, styleFor([]))],
        state: previousState,
        untokenized: true,
      }

    const result = grammar.tokenizeLine(line, state, 0)
    return {
      tokens: result.tokens
        .filter((token) => token.startIndex < line.length)
        .map((token) =>
          scopedToken(line, token.startIndex, token.endIndex, styleFor(token.scopes)),
        ),
      state: new GrammarLineState(result.ruleStack),
    }
  }

  return {
    tokenize,
    statesEqual: statesEqual,
    setTheme: (name) => {
      theme = Theme.createFromRawTheme(highlighter.getTheme(name))
      for (const style of styles.values()) applyTheme(style, theme)
    },
  }
}

function scopedToken(line: string, start: number, end: number, style: ScopeStyle): ThemedToken {
  return new ScopedToken(line.slice(start, end), start, style)
}

class ScopedToken implements ThemedToken {
  readonly #style: ScopeStyle

  constructor(
    readonly content: string,
    readonly offset: number,
    style: ScopeStyle,
  ) {
    this.#style = style
    Object.defineProperties(this, TOKEN_STYLE_PROPERTIES)
  }

  get color() {
    return this.#style.color
  }

  get fontStyle() {
    return this.#style.fontStyle
  }
}

// Shared getters keep a stable object shape while preserving enumerable public token fields.
const TOKEN_STYLE_PROPERTIES = {
  color: { ...Object.getOwnPropertyDescriptor(ScopedToken.prototype, 'color'), enumerable: true },
  fontStyle: {
    ...Object.getOwnPropertyDescriptor(ScopedToken.prototype, 'fontStyle'),
    enumerable: true,
  },
}

function statesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  return (
    left instanceof GrammarLineState &&
    right instanceof GrammarLineState &&
    left.stack.equals(right.stack)
  )
}

function applyTheme(style: ScopeStyle, theme: Theme): void {
  const defaults = theme.getDefaults()
  let foreground = defaults.foregroundId
  let fontStyle = defaults.fontStyle
  const paths: NonNullable<Parameters<Theme['match']>[0]>[] = []
  for (let path: Parameters<Theme['match']>[0] = style.path; path; path = path.parent)
    paths.push(path)
  for (const path of paths.reverse()) {
    const match = theme.match(path)
    if (!match) continue
    if (match.foregroundId !== 0) foreground = match.foregroundId
    if (match.fontStyle !== -1) fontStyle = match.fontStyle
  }
  style.color = theme.getColorMap()[foreground] ?? ''
  style.fontStyle = fontStyle
}
