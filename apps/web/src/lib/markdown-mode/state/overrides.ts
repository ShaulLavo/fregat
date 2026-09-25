import { create } from 'zustand'

import type { MarkdownView } from '@/lib/markdown-mode/utils/mode'

/**
 * Per-document picks made with Cycle markdown view. Not persisted: a pick is about the file on
 * screen now, and the setting is the default everything else opens in.
 */
export const useMarkdownViewOverrides = create<{
  readonly views: Readonly<Record<string, MarkdownView>>
}>(() => ({ views: {} }))

export function setMarkdownViewOverride(documentKey: string, view: MarkdownView) {
  useMarkdownViewOverrides.setState((state) => ({ views: { ...state.views, [documentKey]: view } }))
}

export function markdownViewOverride(documentKey: string): MarkdownView | undefined {
  return useMarkdownViewOverrides.getState().views[documentKey]
}
