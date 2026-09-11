type WorkLogScrollPosition = { top: number; left: number }

const positions = new Map<string, WorkLogScrollPosition>()
const MAX_POSITIONS = 500

export function attachWorkLogScroll(element: HTMLElement, key: string) {
  const saved = positions.get(key)
  if (saved) {
    element.scrollTop = saved.top
    element.scrollLeft = saved.left
  }
  let contentLength: number | null = null
  let atEnd = isAtEnd(element)
  const remember = () => {
    atEnd = isAtEnd(element)
    savePosition(key, element)
  }
  // Child disclosures change the scroll boundary without rerendering their group.
  const mutationObserver = new MutationObserver(remember)
  const resizeObserver = new ResizeObserver(remember)
  mutationObserver.observe(element, { childList: true, characterData: true, subtree: true })
  resizeObserver.observe(element)
  element.addEventListener('scroll', remember, { passive: true })
  remember()

  return {
    update(nextLength: number) {
      if (contentLength !== null && nextLength > contentLength && atEnd)
        element.scrollTop = element.scrollHeight
      contentLength = nextLength
      remember()
    },
    dispose() {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      element.removeEventListener('scroll', remember)
    },
  }
}

function isAtEnd(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= 1
}

function savePosition(key: string, element: HTMLElement) {
  positions.delete(key)
  positions.set(key, { top: element.scrollTop, left: element.scrollLeft })
  if (positions.size <= MAX_POSITIONS) return
  const oldest = positions.keys().next().value
  if (oldest !== undefined) positions.delete(oldest)
}
