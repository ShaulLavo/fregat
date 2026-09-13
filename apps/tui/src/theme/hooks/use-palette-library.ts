import { bundledPalette, parsePalette, type Palette } from '@workspace/contracts'
import type { Client } from '@workspace/client-core/transport/client'
import { useEffect, useState } from 'react'

/**
 * The palette behind an id: bundled at once, otherwise fetched from the user's
 * library. Graphite until a user palette arrives; a lookup that fails stays on
 * Graphite rather than retrying on every render.
 */
export function usePaletteLibrary(client: Client | null, id: string): Palette | undefined {
  const bundled = bundledPalette(id)
  const [fetched, setFetched] = useState<Palette | null>(null)
  useEffect(() => {
    if (bundled || !client) return
    let active = true
    void client.themes
      .palettes({ id })
      .get()
      .then((response) => {
        if (!active || !response.data) return
        const parsed = parsePalette(response.data, 'user')
        if (parsed.success) setFetched(parsed.palette)
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [bundled, client, id])
  if (bundled) return bundled

  return fetched?.id === id ? fetched : undefined
}
