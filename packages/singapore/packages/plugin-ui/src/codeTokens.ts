import type { EditorSnippetTokensFeature } from '@singapore-editor/core/extensions'
import type { EditorToken } from '@singapore-editor/core/syntax'

const MAX_CACHED_SNIPPETS = 64

// Long enough for a worker round trip behind the document's own work, short enough that a hover
// held for it never reads as late.
const TOKEN_HOLD_MS = 250

export type TooltipCodeBlock = {
  readonly text: string
  readonly languageId: string
}

/**
 * The editor's own tokens for a hover's fenced code. Settled answers are kept because a hover
 * re-renders whole as each participant reports, and a block that repainted from plain on every
 * render would flash. Tokens can carry a theme's literal colours, so a theme change clears them.
 */
export type TooltipCodeTokenizer = {
  cached(text: string, languageId: string): readonly EditorToken[] | null
  tokenize(text: string, languageId: string): Promise<readonly EditorToken[]>
  /**
   * Null when every block can paint in colour now, or was already waited for once. Otherwise
   * settles when they can or the hold runs out, so a hover opens coloured instead of turning.
   */
  prepare(blocks: readonly TooltipCodeBlock[]): Promise<void> | null
  clear(): void
}

export function createTooltipCodeTokenizer(
  feature: Pick<EditorSnippetTokensFeature, 'tokenize'>,
): TooltipCodeTokenizer {
  const settled = new Map<string, readonly EditorToken[]>()
  const inFlight = new Map<string, Promise<readonly EditorToken[]>>()
  const heldOnce = new Set<string>()
  const keyFor = (text: string, languageId: string): string => `${languageId}\n${text}`

  const remember = (key: string, tokens: readonly EditorToken[]): void => {
    if (settled.size >= MAX_CACHED_SNIPPETS) settled.delete(settled.keys().next().value!)
    settled.set(key, tokens)
  }

  const tokenize = (text: string, languageId: string): Promise<readonly EditorToken[]> => {
    const key = keyFor(text, languageId)
    const known = settled.get(key)
    if (known) return Promise.resolve(known)

    const running = inFlight.get(key)
    if (running) return running

    // A failed parse settles as plain, so a broken grammar is not asked again on every render.
    const request = feature
      .tokenize(text, languageId)
      .catch((): readonly EditorToken[] => [])
      .then((tokens) => {
        inFlight.delete(key)
        remember(key, tokens)
        return tokens
      })
    inFlight.set(key, request)
    return request
  }

  return {
    cached: (text, languageId) => settled.get(keyFor(text, languageId)) ?? null,
    tokenize,
    prepare: (blocks) => {
      const waiting: Promise<unknown>[] = []
      for (const block of blocks) {
        const key = keyFor(block.text, block.languageId)
        if (settled.has(key) || heldOnce.has(key)) continue

        heldOnce.add(key)
        waiting.push(tokenize(block.text, block.languageId))
      }
      if (waiting.length === 0) return null

      return Promise.race([Promise.all(waiting), holdTimeout()]).then(() => undefined)
    },
    clear: () => {
      settled.clear()
      heldOnce.clear()
    },
  }
}

function holdTimeout(): Promise<void> {
  // @justification Caps how long a hover waits for tokens before painting plain; it only resolves
  // the losing side of a race.
  return new Promise((resolve) => setTimeout(resolve, TOKEN_HOLD_MS))
}

export function paintCodeTokens(
  document: Document,
  code: HTMLElement,
  text: string,
  tokens: readonly EditorToken[],
): void {
  if (tokens.length === 0) return

  const nodes: Node[] = []
  let cursor = 0
  for (const token of tokens) {
    const start = Math.max(token.start, cursor)
    const end = Math.min(token.end, text.length)
    if (end <= start) continue

    if (start > cursor) nodes.push(document.createTextNode(text.slice(cursor, start)))
    nodes.push(tokenElement(document, text.slice(start, end), token))
    cursor = end
  }
  if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)))
  code.replaceChildren(...nodes)
}

function tokenElement(document: Document, text: string, token: EditorToken): HTMLElement {
  const element = document.createElement('span')
  element.textContent = text
  const { color, fontStyle, fontWeight, textDecoration } = token.style
  if (color) element.style.color = color
  if (fontStyle) element.style.fontStyle = fontStyle
  if (fontWeight !== undefined) element.style.fontWeight = String(fontWeight)
  if (textDecoration) element.style.textDecoration = textDecoration
  return element
}
