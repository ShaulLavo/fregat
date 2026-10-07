import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

type State = { kind: 'open'; root: Root | null } | { kind: 'disposed' }

export function createRenderer() {
  let state: State = { kind: 'open', root: null }

  function render(create: () => Root, children: ReactNode): boolean {
    if (state.kind === 'disposed') return false
    state.root ??= create()
    state.root.render(children)
    return true
  }

  function dispose() {
    if (state.kind === 'disposed') return
    const root = state.root
    state = { kind: 'disposed' }
    root?.unmount()
  }

  return {
    render,
    dispose,
    get disposed() {
      return state.kind === 'disposed'
    },
  }
}
