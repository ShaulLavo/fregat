import type { CliRenderer } from '@opentui/core'

const sources = new WeakMap<CliRenderer, ReturnType<typeof createSource>>()

export function systemColorModeSource(renderer: CliRenderer) {
  const retained = sources.get(renderer)
  if (retained) return retained
  const source = createSource(renderer)
  sources.set(renderer, source)
  return source
}

function createSource(renderer: CliRenderer) {
  const readers = new Set<() => void>()
  const notify = () => {
    for (const reader of readers) reader()
  }
  const release = (reader: () => void) => {
    readers.delete(reader)
    if (readers.size === 0) renderer.off('theme_mode', notify)
  }
  return {
    getSnapshot: () => renderer.themeMode ?? 'dark',
    subscribe(reader: () => void) {
      readers.add(reader)
      if (readers.size === 1) renderer.on('theme_mode', notify)
      return () => release(reader)
    },
  }
}
