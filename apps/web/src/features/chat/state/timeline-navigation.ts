import {
  isTimelineWithinFollowBand,
  timelineContentScrollsUp,
  TIMELINE_COMPOSER_INSET_PX,
  type TimelineScrollEvent,
  type TimelineViewportMetrics,
} from '@/features/chat/utils/timeline-scroll-anchoring'

const DISCLOSURE_SELECTOR = '[data-scroll-anchor-ignore]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="textbox"]'

export function readTimelineViewport(element: HTMLDivElement): TimelineViewportMetrics {
  return {
    contentHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    viewportHeight: element.clientHeight,
  }
}

export function attachTimelineNavigationListeners({
  element,
  dispatch,
  suspendForDisclosure,
  scrollToStart,
}: {
  element: HTMLDivElement
  dispatch: (event: TimelineScrollEvent) => void
  suspendForDisclosure: (disclosure: Element) => void
  scrollToStart: () => void
}) {
  const contentScrollsUp = () => timelineContentScrollsUp(readTimelineViewport(element))
  const awayFromEnd = () =>
    !isTimelineWithinFollowBand(readTimelineViewport(element), TIMELINE_COMPOSER_INSET_PX)
  const navigate = () => dispatch({ type: 'user-navigated' })

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY >= 0 || !contentScrollsUp()) return
    if (toolOutputConsumesNavigation(event.target, element, 'start')) return

    navigate()
  }
  const handleTouchMove = (event: TouchEvent) => {
    if (!awayFromEnd() || toolOutputConsumesNavigation(event.target, element, 'start')) return

    navigate()
  }
  const handlePointerDown = (event: PointerEvent) => {
    if (disclosureTarget(event.target)) return
    if (event.target === element && contentScrollsUp()) {
      navigate()
      return
    }
    if (!awayFromEnd()) return

    navigate()
  }
  const handleClick = (event: MouseEvent) => {
    const disclosure = disclosureTarget(event.target)
    if (!disclosure) return

    suspendForDisclosure(disclosure)
    // Opening output is reading intent, including activation by Enter or Space.
    if (disclosure.hasAttribute('aria-expanded')) navigate()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    // The browser animates Home and End; row measurements landing on the way cancel the
    // animation partway, so the edges are instant jumps the virtualizer lands exactly.
    const edge = timelineEdgeKey(event)
    if (edge && toolOutputConsumesNavigation(event.target, element, edge)) return
    if (edge === 'end') {
      event.preventDefault()
      dispatch({ type: 'jump-to-end' })
      return
    }
    if (edge === 'start' && contentScrollsUp()) {
      event.preventDefault()
      navigate()
      scrollToStart()
      return
    }
    if (!isTimelineNavigationKey(event)) return
    if (!contentScrollsUp() || toolOutputConsumesNavigation(event.target, element, 'start')) return

    navigate()
  }

  element.addEventListener('wheel', handleWheel, { passive: true })
  element.addEventListener('touchmove', handleTouchMove, { passive: true })
  element.addEventListener('pointerdown', handlePointerDown, { passive: true })
  element.addEventListener('click', handleClick, true)
  element.addEventListener('keydown', handleKeyDown)

  return () => {
    element.removeEventListener('wheel', handleWheel)
    element.removeEventListener('touchmove', handleTouchMove)
    element.removeEventListener('pointerdown', handlePointerDown)
    element.removeEventListener('click', handleClick, true)
    element.removeEventListener('keydown', handleKeyDown)
  }
}

function disclosureTarget(target: EventTarget | null) {
  return target instanceof Element ? target.closest(DISCLOSURE_SELECTOR) : null
}

function timelineEdgeKey(event: KeyboardEvent): 'start' | 'end' | null {
  if (event.defaultPrevented || event.isComposing) return null
  if (event.altKey || event.shiftKey) return null
  if (!(event.target instanceof Element)) return null
  if (event.target.closest(EDITABLE_SELECTOR)) return null
  if (event.key === 'Home') return 'start'
  if (event.key === 'End') return 'end'
  if (!event.metaKey) return null
  if (event.key === 'ArrowUp') return 'start'
  if (event.key === 'ArrowDown') return 'end'
  return null
}

function isTimelineNavigationKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return false
  if (event.altKey || event.shiftKey) return false
  if (event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR)) return false
  if (event.ctrlKey || event.metaKey)
    return event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp')

  return event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'PageUp'
}

/** Whether scrolled tool output between the target and the timeline can still move toward `edge`. */
function toolOutputConsumesNavigation(
  target: EventTarget | null,
  timeline: HTMLElement,
  edge: 'start' | 'end',
) {
  if (!(target instanceof Element)) return false

  const group = target.closest('[data-tool-group-scroll]')
  if (!group) return false

  for (let node: Element | null = target; node && node !== timeline; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    if (edge === 'start' && node.scrollTop > 0) return true
    if (edge === 'end' && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true
  }

  return false
}
