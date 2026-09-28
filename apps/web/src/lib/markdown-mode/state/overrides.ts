import { create } from 'zustand'

import type { MarkdownView } from '@/lib/markdown-mode/utils/mode'

/**
 * Per-document picks made with Cycle markdown view. Not persisted: a pick is about the file on
 * screen now, and the setting is the default everything else opens in.
 */
export const useMarkdownViewOverrides = create<{
  readonly views: Readonly<Record<string, MarkdownView>>
  readonly renderedPanes: Readonly<Record<string, boolean>>
}>(() => ({ views: {}, renderedPanes: {} }))

export function setMarkdownViewOverride(documentKey: string, view: MarkdownView) {
  useMarkdownViewOverrides.setState((state) => ({ views: { ...state.views, [documentKey]: view } }))
}

export function markdownViewOverride(documentKey: string): MarkdownView | undefined {
  return useMarkdownViewOverrides.getState().views[documentKey]
}

export function setMarkdownRenderedPaneOverride(documentKey: string, visible: boolean) {
  useMarkdownViewOverrides.setState((state) => ({
    renderedPanes: { ...state.renderedPanes, [documentKey]: visible },
  }))
}

export function markdownRenderedPaneOverride(documentKey: string): boolean | undefined {
  return useMarkdownViewOverrides.getState().renderedPanes[documentKey]
}
