import { useSyncExternalStore } from 'react'

const INSET_TOKEN = '--density-editor-inset-x'
// The root attributes that pick the token's value.
const DENSITY_ATTRIBUTES = ['data-shell', 'data-density']

let cached: { readonly key: string; readonly inset: number } | null = null

/** Paint the phone's spacing inside the gutter so row tints reach the pane edge. */
export function useEditorGutterInset(): number {
  return useSyncExternalStore(subscribeToDensity, readGutterInset, readServerInset)
}

// A layout effect writes `data-shell` after the editors in the same commit have rendered, so the
// value follows the attribute rather than the shell store.
function subscribeToDensity(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: DENSITY_ATTRIBUTES,
  })
  return () => observer.disconnect()
}

// Keyed on the attributes, so style is read once per change rather than on every render.
function readGutterInset(): number {
  const root = document.documentElement
  const key = DENSITY_ATTRIBUTES.map((name) => root.getAttribute(name)).join('|')
  if (cached?.key === key) return cached.inset
  // `@property` registers the token as a length, so its computed value is already in pixels.
  const pixels = Number.parseFloat(getComputedStyle(root).getPropertyValue(INSET_TOKEN))
  cached = { key, inset: Number.isFinite(pixels) ? pixels : 0 }
  return cached.inset
}

function readServerInset(): number {
  return 0
}
