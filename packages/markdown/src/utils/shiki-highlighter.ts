import { QueryClient } from '@tanstack/query-core'
import { markdownResourceKeys } from '../state/query-keys'
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemeRegistrationAny,
  type TokensResult,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs'

import type { CodeHighlighter, HighlightInput } from '../providers/code-highlighter-context'

export type ShikiHighlighterOptions = {
  /** Light and dark palettes. Both are registered; tokens carry both colours. */
  readonly themes: readonly [ThemeRegistrationAny, ThemeRegistrationAny]
  readonly themeKey: string
  readonly createCore?: typeof createHighlighterCore
}

const PLAIN_TEXT = 'text'

const LANGUAGE_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  bundledLanguagesInfo.flatMap((info) => [
    [info.id, info.id] as const,
    ...(info.aliases ?? []).map((alias) => [alias, info.id] as const),
  ]),
)

/** The grammar id for a fence label, or plain text when shiki has no grammar for it. */
export function resolveLanguage(language: string): string {
  return LANGUAGE_BY_ALIAS.get(language.trim().toLowerCase()) ?? PLAIN_TEXT
}

/**
 * One core highlighter over the full lazy grammar map: every language shiki
 * ships, none of them loaded until a fence asks. The engine is the JavaScript
 * regex engine, so no wasm reaches the boot path either.
 */
export function createShikiHighlighter({
  themes,
  themeKey,
  createCore = createHighlighterCore,
}: ShikiHighlighterOptions): CodeHighlighter {
  const [light, dark] = [namedTheme(themes[0], 'light'), namedTheme(themes[1], 'dark')]
  const engine = createJavaScriptRegexEngine({ forgiving: true })
  const resources = new QueryClient()
  let disposed = false
  const coreOptions = {
    queryKey: markdownResourceKeys.core,
    queryFn: async () => {
      const core = await createCore({ engine, langs: [], themes: [light, dark] })
      if (disposed) core.dispose()
      return core
    },
    staleTime: 'static',
    gcTime: Infinity,
    networkMode: 'always',
    structuralSharing: false,
    retry: false,
  } as const

  function tokens(highlighter: HighlighterCore, code: string, language: string): TokensResult {
    return highlighter.codeToTokens(code, {
      lang: language,
      themes: { dark: dark.name, light: light.name },
    })
  }

  function load(language: string) {
    return resources.query({
      queryKey: markdownResourceKeys.language(language),
      queryFn: async () => {
        const highlighter = await resources.query(coreOptions)
        const grammar = bundledLanguages[language as keyof typeof bundledLanguages]
        if (grammar) await highlighter.loadLanguage(grammar)
        return true
      },
      staleTime: 'static',
      gcTime: Infinity,
      networkMode: 'always',
      structuralSharing: false,
      retry: false,
    })
  }

  return {
    dispose() {
      if (disposed) return
      disposed = true
      resources.getQueryData<HighlighterCore>(markdownResourceKeys.core)?.dispose()
      resources.clear()
    },
    highlight({ code, language }: HighlightInput, onResult) {
      if (disposed) return null
      const resolved = resolveLanguage(language)
      const core = resources.getQueryData<HighlighterCore>(markdownResourceKeys.core)
      if (core && resources.getQueryData(markdownResourceKeys.language(resolved)))
        return safeTokens(core, code, resolved)
      void load(resolved)
        .then(() => {
          if (disposed) return
          const loaded = resources.getQueryData<HighlighterCore>(markdownResourceKeys.core)
          if (loaded) onResult(safeTokens(loaded, code, resolved))
        })
        .catch(() => undefined)
      return null
    },
    themeKey,
  }

  function safeTokens(highlighter: HighlighterCore, code: string, language: string) {
    const loaded = highlighter.getLoadedLanguages().includes(language) ? language : PLAIN_TEXT

    return tokens(highlighter, code, loaded)
  }
}

function namedTheme(
  theme: ThemeRegistrationAny,
  slot: 'dark' | 'light',
): ThemeRegistrationAny & { name: string } {
  return { ...theme, name: theme.name ?? `markdown-${slot}` }
}
