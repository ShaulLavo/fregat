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
}: {
  element: HTMLDivElement
  dispatch: (event: TimelineScrollEvent) => void
  suspendForDisclosure: (disclosure: Element) => void
}) {
  const contentScrollsUp = () => timelineContentScrollsUp(readTimelineViewport(element))
  const awayFromEnd = () =>
    !isTimelineWithinFollowBand(readTimelineViewport(element), TIMELINE_COMPOSER_INSET_PX)
  const navigate = () => dispatch({ type: 'user-navigated' })

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY >= 0 || !contentScrollsUp()) return
    if (toolOutputConsumesUpwardNavigation(event.target, element)) return

    navigate()
  }
  const handleTouchMove = (event: TouchEvent) => {
    if (!awayFromEnd() || toolOutputConsumesUpwardNavigation(event.target, element)) return

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
    if (!isTimelineNavigationKey(event)) return
    if (!contentScrollsUp() || toolOutputConsumesUpwardNavigation(event.target, element)) return

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

function isTimelineNavigationKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return false
  if (event.altKey || event.shiftKey) return false
  if (event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR)) return false
  if (event.ctrlKey || event.metaKey)
    return event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp')

  return event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'PageUp'
}

function toolOutputConsumesUpwardNavigation(target: EventTarget | null, timeline: HTMLElement) {
  if (!(target instanceof Element)) return false

  const group = target.closest('[data-tool-group-scroll]')
  if (!group) return false

  for (let node: Element | null = target; node && node !== timeline; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (node.scrollTop > 0 && (overflow === 'auto' || overflow === 'scroll')) return true
  }

  return false
}
