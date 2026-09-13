import type { Pluggable } from 'unified'

import type { HastExtensions } from '../utils/hast'

export type MarkdownExtensionName = keyof HastExtensions

type ExtensionLoader = () => Promise<{ readonly default: Pluggable }>

type ExtensionLoaders = Readonly<Record<MarkdownExtensionName, ExtensionLoader>>

// Raw HTML costs an HTML parser and math costs KaTeX. Neither is on the boot
// path; each loads the first time a document actually contains it.
const defaultLoaders: ExtensionLoaders = {
  math: () =>
    import('rehype-katex').then((module) => ({ default: [module.default, { output: 'mathml' }] })),
  raw: () => import('rehype-raw'),
}

const NONE: HastExtensions = Object.freeze({ math: null, raw: null })

let loaders: ExtensionLoaders = defaultLoaders
let loaded: HastExtensions = NONE
const pending = new Map<MarkdownExtensionName, Promise<HastExtensions>>()

/** One frozen object per loaded state, so it can key render caches by identity. */
export function loadedMarkdownExtensions(): HastExtensions {
  return loaded
}

export function loadMarkdownExtension(name: MarkdownExtensionName): Promise<HastExtensions> {
  const inFlight = pending.get(name)
  if (inFlight) return inFlight

  const promise = loaders[name]().then(
    (module) => {
      loaded = Object.freeze({ ...loaded, [name]: module.default })
      return loaded
    },
    // A failed load leaves the stage off for the session; the next document
    // that needs it retries.
    () => {
      pending.delete(name)
      return loaded
    },
  )
  pending.set(name, promise)

  return promise
}

/** Test seam: swap the dynamic imports for loaders that fail or resolve on cue. */
export function setMarkdownExtensionLoaders(next: Partial<ExtensionLoaders> | null): void {
  loaders = { ...defaultLoaders, ...next }
  loaded = NONE
  pending.clear()
}
