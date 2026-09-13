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
}: ShikiHighlighterOptions): CodeHighlighter {
  const [light, dark] = [namedTheme(themes[0], 'light'), namedTheme(themes[1], 'dark')]
  const engine = createJavaScriptRegexEngine({ forgiving: true })
  let core: HighlighterCore | null = null
  let ready: Promise<HighlighterCore> | null = null
  // Created on the first fence, not at construction, so building a
  // highlighter during render has no side effect.
  function highlighterCore(): Promise<HighlighterCore> {
    ready ??= createHighlighterCore({ engine, langs: [], themes: [light, dark] }).then(
      (highlighter) => {
        core = highlighter
        return highlighter
      },
    )
    return ready
  }
  const loadedLanguages = new Set<string>([PLAIN_TEXT])
  const loading = new Map<string, Promise<void>>()

  function tokens(highlighter: HighlighterCore, code: string, language: string): TokensResult {
    return highlighter.codeToTokens(code, {
      lang: language,
      themes: { dark: dark.name, light: light.name },
    })
  }

  function load(language: string): Promise<void> {
    const pending = loading.get(language)
    if (pending) return pending

    const grammar = bundledLanguages[language as keyof typeof bundledLanguages]
    const promise = highlighterCore()
      .then((highlighter) => (grammar ? highlighter.loadLanguage(grammar) : undefined))
      .then(
        () => void loadedLanguages.add(language),
        // A grammar that fails to load renders as plain text for the session.
        () => void loadedLanguages.add(language),
      )
    loading.set(language, promise)

    return promise
  }

  return {
    highlight({ code, language }: HighlightInput, onResult) {
      const resolved = resolveLanguage(language)
      if (core && loadedLanguages.has(resolved)) return safeTokens(core, code, resolved)

      void load(resolved).then(() => {
        if (!core) return
        onResult(safeTokens(core, code, resolved))
      })

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
