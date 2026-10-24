import type { EditorTokenStyle } from '../tokens'
import { buildHighlightRule, SharedStyleRules } from '../style-utils'
import type { HighlightRegistry } from './virtualizedTextViewTypes'

export type SharedTokenHandle = {
  readonly name: string
  readonly highlight: Highlight
}

type SharedTokenGroup = {
  readonly name: string
  readonly highlight: Highlight
  readonly rule: string
}

// Token highlight rules are theme-determined and identical across every editor
// instance, yet the CSS Custom Highlight API registry (`CSS.highlights`) and the
// `::highlight()` style rules are document-global. Letting each editor mint its own
// `<style>` in `<head>` + its own registry entries means every editor mount triggers a
// document-wide style recalc. This shares one ref-counted rule + Highlight per token
// `styleKey` per document, so mounting an editor whose styles already exist costs nothing.
const sharedByDocument = new WeakMap<Document, SharedTokenHighlights>()
let nextSharedTokenId = 0
export const SHARED_TOKEN_HIGHLIGHT_PREFIX = 'editor-shared-token-'

export function getSharedTokenHighlights(
  doc: Document,
  registry: HighlightRegistry | null,
): SharedTokenHighlights | null {
  if (!registry) return null

  const existing = sharedByDocument.get(doc)
  if (existing) return existing

  const created = new SharedTokenHighlights(doc, registry)
  sharedByDocument.set(doc, created)
  return created
}

export class SharedTokenHighlights {
  readonly #registry: HighlightRegistry
  readonly #rules: SharedStyleRules
  readonly #groups = new Map<string, SharedTokenGroup>()

  public constructor(doc: Document, registry: HighlightRegistry) {
    this.#registry = registry
    this.#rules = new SharedStyleRules(doc)
  }

  public acquire(styleKey: string, style: EditorTokenStyle): SharedTokenHandle {
    const existing = this.#groups.get(styleKey)
    if (existing) {
      this.#rules.acquire(styleKey, existing.rule)
      return { name: existing.name, highlight: existing.highlight }
    }

    const name = `${SHARED_TOKEN_HIGHLIGHT_PREFIX}${nextSharedTokenId++}`
    const highlight = new Highlight()
    const group: SharedTokenGroup = { name, highlight, rule: buildHighlightRule(name, style) }
    this.#groups.set(styleKey, group)
    this.#registry.set(name, highlight)
    this.#rules.acquire(styleKey, group.rule)
    return { name, highlight }
  }

  public release(styleKey: string): void {
    const group = this.#groups.get(styleKey)
    if (!group) return
    // The registry entry outlives the rule set only if some other view still paints this style,
    // which is exactly what the reference count answers.
    if (!this.#rules.release(styleKey)) return

    this.#groups.delete(styleKey)
    this.#registry.delete(group.name)
  }

  public flush(): void {
    this.#rules.flush()
  }

  public restore(): void {
    this.#rules.restore()
  }
}
