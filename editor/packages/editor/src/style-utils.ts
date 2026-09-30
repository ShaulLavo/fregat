import type { EditorTokenStyle } from './tokens'

/**
 * Every field that makes a style its own style.
 *
 * Deliberately wider than what a highlight can paint: a highlighter with real theme data
 * distinguishes an italic comment from an upright one, and folding those together here would key
 * both onto one group and lose a distinction the theme went to the trouble of making. Identity is
 * one question; what reaches CSS is another, and HIGHLIGHT_DECLARATIONS answers that one.
 */
const STYLE_KEYS: ReadonlyArray<keyof EditorTokenStyle> = [
  'color',
  'backgroundColor',
  'fontStyle',
  'fontWeight',
  'textDecoration',
]

/**
 * The subset a `::highlight()` rule can actually apply.
 *
 * Highlight pseudo-elements admit colour, background-colour, text-decoration, text-shadow and
 * text-stroke and nothing else (CSS Pseudo-Elements 4) — a font property declared here is parsed,
 * kept, and silently ignored at paint. The range side of the house already knows this;
 * VirtualizedTextHighlightStyle offers no font properties at all. Emitting them on the token side
 * only produced rules that lied about what they did.
 */
const HIGHLIGHT_DECLARATIONS: ReadonlyArray<{
  key: keyof EditorTokenStyle
  cssProperty: string
}> = [
  { key: 'color', cssProperty: 'color' },
  { key: 'backgroundColor', cssProperty: 'background-color' },
  { key: 'textDecoration', cssProperty: 'text-decoration' },
]

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function serializeTokenStyle(style: EditorTokenStyle): string {
  const obj: Record<string, unknown> = {}
  for (const key of STYLE_KEYS) obj[key] = style[key]
  return JSON.stringify(obj)
}

export function normalizeTokenStyle(style: EditorTokenStyle): EditorTokenStyle | null {
  const normalized: EditorTokenStyle = {}
  for (const key of STYLE_KEYS) {
    if (style[key]) (normalized as Record<string, unknown>)[key] = style[key]
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function buildHighlightRule(name: string, style: EditorTokenStyle): string {
  const declarations: string[] = []
  for (const { key, cssProperty } of HIGHLIGHT_DECLARATIONS) {
    if (style[key]) declarations.push(`${cssProperty}: ${style[key]};`)
  }
  // A universal highlight selector recalculates pseudo styles across the entire page.
  return `.editor-virtualized-row::highlight(${name}) { ${declarations.join(' ')} }`
}

type SharedStyleEntry = {
  readonly text: string
  refCount: number
}

/**
 * A keyed set of CSS rules backed by a single `<style>` element.
 *
 * Generated rules are almost always wanted by several independent owners at once — two views
 * painting the same token style, two editors resolving the same colour — and a document-wide style
 * recalc is charged per stylesheet mutation, not per rule. Keying the rules and counting references
 * means the second owner of a rule costs nothing, and marking dirty instead of writing means
 * adopting N rules costs one recalc when the batch ends rather than N as it runs.
 *
 * The element stays out of the document while the set is empty so an owner that never generates a
 * rule leaves no trace.
 */
export class SharedStyleRules {
  readonly #doc: Document
  readonly #styleEl: HTMLStyleElement
  readonly #entries = new Map<string, SharedStyleEntry>()
  #dirty = false

  public constructor(doc: Document) {
    this.#doc = doc
    this.#styleEl = doc.createElement('style')
  }

  /** `text` is only read when `key` is new; later acquires of a live key just add a reference. */
  public acquire(key: string, text: string): void {
    const existing = this.#entries.get(key)
    if (existing) {
      existing.refCount += 1
      return
    }

    this.#entries.set(key, { text, refCount: 1 })
    this.#dirty = true
  }

  /** Reports whether that was the last reference, so the caller can drop its own bookkeeping. */
  public release(key: string): boolean {
    const entry = this.#entries.get(key)
    if (!entry) return false

    entry.refCount -= 1
    if (entry.refCount > 0) return false

    this.#entries.delete(key)
    this.#dirty = true
    return true
  }

  public flush(): void {
    if (!this.#dirty) return

    this.#dirty = false
    this.#rebuild()
  }

  public restore(): void {
    this.#rebuild()
  }

  #rebuild(): void {
    const rules: string[] = []
    for (const entry of this.#entries.values()) rules.push(entry.text)

    const nextRules = rules.join('\n')
    if (this.#styleEl.textContent !== nextRules) this.#styleEl.textContent = nextRules
    this.#syncConnection(nextRules)
  }

  #syncConnection(rules: string): void {
    if (rules.length === 0) {
      this.#styleEl.remove()
      return
    }

    if (this.#styleEl.isConnected) return

    this.#doc.head.appendChild(this.#styleEl)
  }
}
