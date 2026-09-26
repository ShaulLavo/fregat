import type { Element } from 'hast'
import { createContext, type ComponentType } from 'react'

export type MarkdownCodeBlockProps = {
  readonly position?: Element['position']
  readonly code: string
  /** The fence has not closed yet; its last line may still be mid-token. */
  readonly incomplete: boolean
  readonly language: string
  /** Everything after the language on the fence line, e.g. `title="src/foo.ts"`. */
  readonly meta: string | undefined
}

export type MarkdownRenderState = {
  /** Renders every fenced block. Absent, a plain `<pre><code>` is used. */
  readonly codeBlock: ComponentType<MarkdownCodeBlockProps> | null
}

export const MarkdownRenderContext = createContext<MarkdownRenderState>({ codeBlock: null })
