import type { ReactNode } from 'react'
import { createStore } from 'zustand/vanilla'

/** `attached` is false while no slot shows the entry, so content can stand down without unmounting. */
export type KeptRender = (attached: boolean) => ReactNode

export type KeptEntry = {
  readonly id: string
  readonly scope: string
  readonly element: HTMLElement
  readonly attached: boolean
  readonly render: KeptRender
}

/**
 * Content that must outlive the layout around it. An entry renders once, into an
 * element the store owns; slots only adopt that element, so unmounting a slot
 * parks the content instead of destroying it. Entries leave by `prune` alone.
 */
export function createKeepAliveStore() {
  const entries = createStore<readonly KeptEntry[]>(() => [])
  let parking: HTMLElement | null = null

  function commit(next: readonly KeptEntry[]) {
    entries.setState(next, true)
  }

  function replace(id: string, update: (entry: KeptEntry) => KeptEntry) {
    commit(entries.getState().map((entry) => (entry.id === id ? update(entry) : entry)))
  }

  function find(id: string) {
    return entries.getState().find((entry) => entry.id === id)
  }

  return {
    entries,
    setParking(element: HTMLElement | null) {
      parking = element
    },
    publish(id: string, scope: string, render: KeptRender) {
      if (find(id)) {
        replace(id, (entry) => ({ ...entry, render, scope }))
        return
      }
      const element = document.createElement('div')
      element.className = 'size-full min-h-0 min-w-0'
      commit(entries.getState().concat([{ id, scope, element, attached: false, render }]))
    },
    attach(id: string, container: HTMLElement) {
      const entry = find(id)
      if (!entry) return
      container.appendChild(entry.element)
      replace(id, (current) => ({ ...current, attached: true }))
    },
    park(id: string) {
      const entry = find(id)
      if (!entry) return
      // Parked, not detached: a node outside the document cannot be measured or refocused.
      if (parking) parking.appendChild(entry.element)
      else entry.element.remove()
      replace(id, (current) => ({ ...current, attached: false }))
    },
    /** Drops every entry of `scope` that is not in `ids`. The only way content is destroyed. */
    prune(scope: string, ids: readonly string[]) {
      const current = entries.getState()
      const kept = current.filter((entry) => entry.scope !== scope || ids.includes(entry.id))
      if (kept.length === current.length) return
      for (const entry of current) {
        if (!kept.includes(entry)) entry.element.remove()
      }
      commit(kept)
    },
  }
}

export type KeepAliveStore = ReturnType<typeof createKeepAliveStore>
