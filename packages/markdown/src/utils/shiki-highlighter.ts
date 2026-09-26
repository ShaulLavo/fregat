import type { HighlighterCore, ThemeRegistrationAny, TokensResult } from 'shiki/core'
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
  let core: HighlighterCore | null = null
  let ready: Promise<HighlighterCore> | null = null
  // Created on the first fence, not at construction, so building a
  // highlighter during render has no side effect.
  function highlighterCore(): Promise<HighlighterCore> {
    ready ??= loadHighlighterCore([light, dark]).then(
      (highlighter) => {
        core = highlighter
        return highlighter
      },
      (error: unknown) => {
        // The next fence tries again instead of inheriting a rejected promise.
        ready = null
        throw error
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
    const promise = highlighterCore().then(
      async (highlighter) => {
        // A grammar that fails to load renders as plain text for the session.
        if (grammar) await highlighter.loadLanguage(grammar).catch(noop)
        loadedLanguages.add(language)
      },
      // A core that failed to load is retried by the next fence.
      () => void loading.delete(language),
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

// Shiki loads with the first fence; a static import would put it in the entry chunk.
async function loadHighlighterCore(themes: ThemeRegistrationAny[]): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ])
  return createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [],
    themes,
  })
}

function namedTheme(
  theme: ThemeRegistrationAny,
  slot: 'dark' | 'light',
): ThemeRegistrationAny & { name: string } {
  return { ...theme, name: theme.name ?? `markdown-${slot}` }
}

function noop() {}
