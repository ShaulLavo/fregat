import { HighlightedPreview } from '@/features/search/components/highlight'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'

/**
 * Why a row is in the list when its title says nothing about what was typed:
 * the phrase was found inside the conversation. Without it, a server match
 * renders as a row the user cannot explain.
 *
 * The row subscribes to its own match rather than being handed one, so a search
 * does not have to be passed through the group that only forwards it.
 */
export function SessionRowSnippet({ sessionKey }: { readonly sessionKey: string }) {
  const match = useSessionSearchStore((state) => state.matchBySessionKey[sessionKey])
  // The query the matches belong to, not the one being typed: highlighting
  // against a live keystroke misses on every frame before the request settles.
  const matchedQuery = useSessionSearchStore((state) => state.matchedQuery)
  if (!match) return null

  return (
    <span className='text-2xs flex min-w-0 items-center gap-1.5 pl-[14px] leading-4 opacity-60'>
      <span className='shrink-0'>{match.source === 'user' ? 'You' : 'Agent'}</span>
      <span className='min-w-0 flex-1'>
        {match.snippet ? (
          <HighlightedPreview preview={match.snippet} query={matchedQuery} />
        ) : (
          // A match with no readable snippet still has to explain the row.
          <span className='italic'>matched this conversation</span>
        )}
      </span>
    </span>
  )
}
