import { useSyncExternalStore } from 'react'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { diagramTheme } from '@/features/chat/utils/diagram-theme'

function readFont() {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()
}

function observeFont(notify: () => void) {
  const observer = new MutationObserver(notify)
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  })
  document.fonts.addEventListener('loadingdone', notify)
  return () => {
    observer.disconnect()
    document.fonts.removeEventListener('loadingdone', notify)
  }
}

export function useDiagramTheme() {
  const { resolved } = usePalette()
  const fontFamily = useSyncExternalStore(observeFont, readFont)
  return diagramTheme(resolved, fontFamily)
}
