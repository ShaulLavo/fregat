import { useState, useSyncExternalStore } from 'react'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { diagramTheme } from '@/features/chat/utils/diagram-theme'
import { createDiagramFontSource } from '@/features/chat/state/diagram-font'

export function useDiagramTheme() {
  const { resolved } = usePalette()
  const [source] = useState(createDiagramFontSource)
  const font = useSyncExternalStore(source.subscribe, source.read)
  return { ...diagramTheme(resolved, font.fontFamily), fontGeneration: font.generation }
}
