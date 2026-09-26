import type { FragmentInstance } from 'react'

export type WorkLogContent = { kind: 'text' } | { kind: 'rows'; fragment: FragmentInstance }

type WorkLogScrollAnchor = { id: string; offset: number }
type WorkLogScrollPosition = { top: number; left: number; anchor: WorkLogScrollAnchor | null }

const positions = new Map<string, WorkLogScrollPosition>()
const MAX_POSITIONS = 500

export function attachWorkLogScroll(element: HTMLElement, key: string, content: WorkLogContent) {
  const saved = positions.get(key)
  if (saved) {
    element.scrollTop = saved.top
    element.scrollLeft = saved.left
    restoreEntryAnchor(element, saved.anchor)
  }
  let contentLength: number | null = null
  let atEnd = isAtEnd(element)
  const remember = () => {
    atEnd = isAtEnd(element)
    savePosition(key, element)
  }
  // Capped text can grow its scroll boundary without changing its observed box.
  const mutationObserver = content.kind === 'text' ? new MutationObserver(remember) : null
  const resizeObserver = new ResizeObserver(remember)
  mutationObserver?.observe(element, { childList: true, characterData: true, subtree: true })
  if (content.kind === 'rows') content.fragment.observeUsing(resizeObserver)
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
      mutationObserver?.disconnect()
      if (content.kind === 'rows') content.fragment.unobserveUsing(resizeObserver)
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
  positions.set(key, {
    top: element.scrollTop,
    left: element.scrollLeft,
    anchor: readEntryAnchor(element),
  })
  if (positions.size <= MAX_POSITIONS) return
  const oldest = positions.keys().next().value
  if (oldest !== undefined) positions.delete(oldest)
}

function readEntryAnchor(element: HTMLElement): WorkLogScrollAnchor | null {
  const top = element.getBoundingClientRect().top
  const rows = element.querySelectorAll<HTMLElement>('[data-work-log-entry-id]')
  for (const row of rows) {
    const bounds = row.getBoundingClientRect()
    if (bounds.bottom <= top) continue
    const id = row.dataset.workLogEntryId
    if (id) return { id, offset: bounds.top - top }
  }
  return null
}

function restoreEntryAnchor(element: HTMLElement, anchor: WorkLogScrollAnchor | null) {
  if (!anchor) return
  const rows = element.querySelectorAll<HTMLElement>('[data-work-log-entry-id]')
  const row = Array.from(rows).find((candidate) => candidate.dataset.workLogEntryId === anchor.id)
  if (!row) return

  element.scrollTop +=
    row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
}
