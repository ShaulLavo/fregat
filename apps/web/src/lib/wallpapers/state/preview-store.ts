import type { WallpaperSource } from '@workspace/contracts'
import { create } from 'zustand'

type WallpaperPreviewStore = {
  // Outranks the saved selection while a picker is highlighting; never written to settings.
  readonly source: WallpaperSource | null
  readonly preview: (source: WallpaperSource) => void
  readonly clear: () => void
}

export const useWallpaperPreviewStore = create<WallpaperPreviewStore>((set, get) => ({
  source: null,
  preview: (source) => set({ source }),
  clear: () => {
    if (get().source) set({ source: null })
  },
}))
