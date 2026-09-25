import { QueryClient } from '@tanstack/query-core'
import type { Pluggable } from 'unified'
import type { HastExtensions } from '../utils/hast'
import { markdownResourceKeys } from './query-keys'

export type MarkdownExtensionName = keyof HastExtensions

type ExtensionLoader = () => Promise<{ readonly default: Pluggable }>
type ExtensionLoaders = Readonly<Record<MarkdownExtensionName, ExtensionLoader>>

const defaultLoaders: ExtensionLoaders = {
  math: () =>
    import('rehype-katex').then((module) => ({ default: [module.default, { output: 'mathml' }] })),
  raw: () => import('rehype-raw'),
}

const NONE: HastExtensions = Object.freeze({ math: null, raw: null })
const resources = new QueryClient()
let loaders: ExtensionLoaders = defaultLoaders
let snapshot: HastExtensions = NONE

// A stable derived snapshot keys the synchronous parser/render caches.
export function loadedMarkdownExtensions(): HastExtensions {
  const raw = resources.getQueryData<Pluggable>(markdownResourceKeys.extension('raw')) ?? null
  const math = resources.getQueryData<Pluggable>(markdownResourceKeys.extension('math')) ?? null
  if (snapshot.raw === raw && snapshot.math === math) return snapshot
  snapshot = raw || math ? Object.freeze({ raw, math }) : NONE
  return snapshot
}

export function subscribeMarkdownExtensions(listener: () => void) {
  return resources.getQueryCache().subscribe(listener)
}

export function loadMarkdownExtension(name: MarkdownExtensionName): Promise<HastExtensions> {
  return resources
    .query({
      queryKey: markdownResourceKeys.extension(name),
      queryFn: async () => (await loaders[name]()).default,
      staleTime: 'static',
      gcTime: Infinity,
      networkMode: 'always',
      structuralSharing: false,
      retry: false,
    })
    .then(loadedMarkdownExtensions)
    .catch(loadedMarkdownExtensions)
}

export function setMarkdownExtensionLoaders(next: Partial<ExtensionLoaders> | null): void {
  loaders = { ...defaultLoaders, ...next }
  resources.clear()
  snapshot = NONE
}
