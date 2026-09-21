import { retryableImport } from '@/lib/retryable-import'

let loaded: typeof import('@/features/terminal/components/panel') | undefined
export const loadTerminalPanel = retryableImport(async () => {
  loaded = await import('@/features/terminal/components/panel')
  return loaded
})
export function loadedTerminalPanel() {
  return loaded
}
