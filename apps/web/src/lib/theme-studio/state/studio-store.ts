import type { ColorMode, Palette, ThemeBundle, ThemeVariant } from '@workspace/contracts'
import { create } from 'zustand'

export type StudioTab = 'themes' | 'colors' | 'code' | 'wallpaper' | 'surfaces'

/** The theme being tried: a library theme and both halves as edited so far. */
export type StudioDraft = {
  readonly theme: ThemeBundle
  readonly variants: { readonly light: ThemeVariant; readonly dark: ThemeVariant }
}

type StudioState = {
  readonly generation: number
  readonly open: boolean
  readonly collapsed: boolean
  readonly tab: StudioTab
  /** The half shown while the studio is open; null follows the app's own mode. */
  readonly mode: ColorMode | null
  /** Null until the first change: the saved theme is the draft until then. */
  readonly draft: StudioDraft | null
  /** A half's colors as edited: a copy of its palette, saved to the library on Apply. */
  readonly paletteEdits: Partial<Record<ColorMode, Palette>>
  /** A dirty Escape asks once: the second press discards. */
  readonly confirmingDiscard: boolean
  readonly openStudio: () => void
  readonly closeStudio: () => void
  readonly setDraft: (draft: StudioDraft) => void
  readonly setPaletteEdit: (mode: ColorMode, palette: Palette | null) => void
  /** Starts over from another theme, dropping any color edits. */
  readonly chooseTheme: (draft: StudioDraft) => void
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
  paletteEdits: {},
  confirmingDiscard: false,
} as const

/** Transient by design: nothing about an unapplied draft survives a reload. */
export const useStudioStore = create<StudioState>((set) => ({
  ...CLOSED,
  generation: 0,
  openStudio: () =>
    set((state) => {
      if (state.open) return { collapsed: false, tab: 'themes' }
      return {
        ...CLOSED,
        open: true,
        generation: state.generation + 1,
      }
    }),
  closeStudio: () => set((state) => ({ ...CLOSED, generation: state.generation + 1 })),
  setDraft: (draft) => set({ draft, confirmingDiscard: false }),
  setPaletteEdit: (mode, palette) =>
    set((state) => {
      const { [mode]: _dropped, ...rest } = state.paletteEdits
      return {
        paletteEdits: palette ? { ...rest, [mode]: palette } : rest,
        confirmingDiscard: false,
      }
    }),
  chooseTheme: (draft) =>
    set((state) => ({
      draft,
      paletteEdits: {},
      confirmingDiscard: false,
      generation: state.generation + 1,
    })),
  revert: () =>
    set((state) => ({
      draft: null,
      paletteEdits: {},
      confirmingDiscard: false,
      generation: state.generation + 1,
    })),
  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode }),
  setCollapsed: (collapsed) => set({ collapsed }),
  setConfirmingDiscard: (confirmingDiscard) => set({ confirmingDiscard }),
}))
