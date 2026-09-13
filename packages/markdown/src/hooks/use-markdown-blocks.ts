import { useMemo } from 'react'
import type { PluggableList } from 'unified'

import type { MarkdownBlock } from '../utils/blocks'
import { createMarkdownSession } from '../utils/session'

/**
 * Parses the document incrementally across renders. The session is the parse
 * cache, so it must survive re-renders and be rebuilt only when the plugin
 * list — and with it the parser — changes; that is what the memo is for.
 */
export function useMarkdownBlocks(
  text: string,
  { heal, remarkPlugins }: { readonly heal: boolean; readonly remarkPlugins?: PluggableList },
): readonly MarkdownBlock[] {
  const session = useMemo(() => createMarkdownSession({ remarkPlugins }), [remarkPlugins])

  return session.update(text, { heal })
}
