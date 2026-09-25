import type { ColorMode, ThemeBundle, ThemeVariant } from '@workspace/contracts'
import { create } from 'zustand'

export type StudioTab = 'themes' | 'colors' | 'code' | 'wallpaper' | 'surfaces'

/** The theme being tried: a library theme and both halves as edited so far. */
export type StudioDraft = {
  readonly theme: ThemeBundle
  readonly variants: { readonly light: ThemeVariant; readonly dark: ThemeVariant }
}

type StudioState = {
  readonly open: boolean
  readonly collapsed: boolean
  readonly tab: StudioTab
  /** The half shown while the studio is open; null follows the app's own mode. */
  readonly mode: ColorMode | null
  /** Null until the first change: the saved theme is the draft until then. */
  readonly draft: StudioDraft | null
  /** A dirty Escape asks once: the second press discards. */
  readonly confirmingDiscard: boolean
  readonly openStudio: () => void
  readonly closeStudio: () => void
  readonly setDraft: (draft: StudioDraft) => void
  /** Back to the saved theme, still in the studio. */
  readonly revert: () => void
  readonly setTab: (tab: StudioTab) => void
  readonly setMode: (mode: ColorMode) => void
  readonly setCollapsed: (collapsed: boolean) => void
  readonly setConfirmingDiscard: (confirming: boolean) => void
}

const CLOSED = {
  open: false,
  collapsed: false,
  tab: 'themes',
  mode: null,
  draft: null,
  confirmingDiscard: false,
} as const

/** The command that opened the studio refocuses it when it is already open. */
export function focusThemeStudio() {
  document.querySelector<HTMLElement>('[data-studio-themes]')?.focus()
}

/** Transient by design: nothing about an unapplied draft survives a reload. */
export const useStudioStore = create<StudioState>((set) => ({
  ...CLOSED,
  openStudio: () => set((state) => (state.open ? state : { ...CLOSED, open: true })),
  closeStudio: () => set(CLOSED),
  setDraft: (draft) => set({ draft, confirmingDiscard: false }),
  revert: () => set({ draft: null, confirmingDiscard: false }),
  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setConfirmingDiscard: (confirmingDiscard) => set({ confirmingDiscard }),
}))
