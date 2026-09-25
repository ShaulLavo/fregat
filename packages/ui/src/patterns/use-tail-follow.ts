import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type Key,
  type RefObject,
} from 'react'

import {
  TAIL_FOLLOWING,
  arrivedAtEdge,
  isAtEdge,
  tailFollowArrived,
  tailFollowScrolled,
  type TailEdge,
  type TailFollow,
} from '@workspace/ui/patterns/tail-follow'

/**
 * Whether a list is following its live edge, and how many rows arrived while it was not. The
 * state is pure (`tail-follow.ts`); this hook only wires the scroller's scroll events to it.
 */
export function useTailFollow({
  edge,
  enabled,
  keys,
  scrollRef,
  scrollToEdge,
  slack,
}: {
  readonly edge: TailEdge
  readonly enabled: boolean
  readonly keys: readonly Key[]
  readonly scrollRef: RefObject<HTMLElement | null>
  /** Brings the live edge into view; a virtualized list scrolls by index. */
  readonly scrollToEdge: () => void
  /** How close to the edge still counts as at it, usually one row. */
  readonly slack: number
}): TailFollow & { readonly jumpToEdge: () => void } {
  const [state, setState] = useState<TailFollow>(TAIL_FOLLOWING)
  const edgeKey = edge === 'start' ? keys[0] : keys.at(-1)
  const previousEdgeKey = useRef(edgeKey)
  const previousHeight = useRef(0)

  const arrive = useEffectEvent((key: Key | undefined, grown: number) => {
    const count = arrivedAtEdge(keys, previousEdgeKey.current, edge)
    previousEdgeKey.current = key
    if (!enabled || count === 0) return
    if (state.following) {
      // At the start edge a prepend leaves scrollTop at 0; at the end the list has to be moved.
      if (edge === 'end') scrollToEdge()
    } else if (edge === 'start' && scrollRef.current) {
      // Rows prepended above the reader push the line being read down by their height.
      scrollRef.current.scrollTop += grown
    }
    setState((previous) => tailFollowArrived(previous, count))
  })

  // Every commit: the height has to be known from the one before the rows arrived.
  useLayoutEffect(() => {
    const height = scrollRef.current?.scrollHeight ?? 0
    const grown = height - previousHeight.current
    previousHeight.current = height
    arrive(edgeKey, grown)
  })

  useEffect(() => {
    const element = scrollRef.current
    if (!enabled || !element) return
    const onScroll = () =>
      setState((previous) => tailFollowScrolled(previous, isAtEdge(element, edge, slack)))
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [edge, enabled, scrollRef, slack])

  return {
    ...state,
    jumpToEdge: () => {
      scrollToEdge()
      setState(TAIL_FOLLOWING)
    },
  }
}
