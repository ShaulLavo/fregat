import { createContext } from 'react'

/** Pins and removals for the sidebar, saved in the browsed machine's settings. */
export type PickerLocationActions = {
  readonly pinned: readonly string[]
  readonly hiddenCount: number
  readonly pin: (path: string) => void
  readonly unpin: (path: string) => void
  readonly hide: (path: string) => void
  readonly restoreHidden: () => void
}

export const PickerLocationActionsContext = createContext<PickerLocationActions | null>(null)
