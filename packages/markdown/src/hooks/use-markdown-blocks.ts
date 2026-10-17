import { use, useMemo } from 'react'
import type { PluggableList } from 'unified'

import type { MarkdownBlock } from '../utils/blocks'
import { MarkdownSessionContext } from '../providers/session-context'

/**
 * Parses the document incrementally across renders. The session is the parse
 * cache; its factory and transform list key the memo that preserves settled
 * block identity across renders.
 */
export function useMarkdownBlocks(
  text: string,
  { heal, remarkPlugins }: { readonly heal: boolean; readonly remarkPlugins?: PluggableList },
): readonly MarkdownBlock[] {
  const factory = use(MarkdownSessionContext)
  const session = useMemo(() => factory({ remarkPlugins }), [factory, remarkPlugins])

  return session.update(text, { heal })
}
