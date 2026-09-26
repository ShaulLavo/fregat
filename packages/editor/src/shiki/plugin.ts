import type {
  EditorHighlighterProvider,
  EditorHighlighterSessionOptions,
  EditorPlugin,
} from '../plugins'
import type { EditorSyntaxLanguageId } from '../syntax/session'
import {
  createShikiWorkerOwner,
  type ShikiHighlighterSessionOptions,
  type ShikiPreloadRegistrations,
  type ShikiResolvedRegistrations,
  type ShikiWorkerOwner,
} from './workerClient'
import type { ShikiWorkerLanguageRegistration, ShikiWorkerThemeRegistration } from './workerTypes'

export type ShikiLanguageMap = Partial<Record<EditorSyntaxLanguageId, string>>

export type ShikiLanguageRegistrationResolver = (
  language: string,
) => Promise<readonly ShikiWorkerLanguageRegistration[]>

export type ShikiThemeRegistrationResolver = (
  theme: string,
) => Promise<ShikiWorkerThemeRegistration>

export type ShikiHighlighterPluginOptions = {
  readonly resolveLanguage: ShikiLanguageRegistrationResolver
  readonly resolveTheme: ShikiThemeRegistrationResolver
  readonly theme?: string | (() => string)
  readonly languages?: ShikiLanguageMap
  /** Grammars loaded in the background after the first highlight; a getter is read then. */
  readonly preloadLanguages?: readonly string[] | (() => readonly string[])
  /** Additional themes to load in the background after a session opens. */
  readonly preloadThemes?: readonly string[] | (() => readonly string[])
  readonly onThemeChanged?: (listener: () => void) => (() => void) | void
  readonly workerOwner?: ShikiWorkerOwner
}

const DEFAULT_THEME = 'github-dark'
const DEFAULT_SHIKI_WORKER_OWNER_KEY = Symbol.for(
  '@singapore-editor/core/shiki/default-worker-owner',
)

const DEFAULT_LANGUAGE_MAP: ShikiLanguageMap = {
  css: 'css',
  html: 'html',
  javascriptreact: 'jsx',
  javascript: 'javascript',
  json: 'json',
  tsx: 'tsx',
  typescriptreact: 'tsx',
  typescript: 'typescript',
}

export function createShikiHighlighterPlugin(options: ShikiHighlighterPluginOptions): EditorPlugin {
  return {
    name: 'shiki-highlighter',
    activate(context) {
      return context.registerHighlighter(createShikiHighlighterProvider(options))
    },
  }
}

/**
 * Builds the provider separately from its editor plugin so secondary views can share the exact
 * highlighter, worker owner, language map and theme resolver used by regular editor documents.
 */
export function createShikiHighlighterProvider(
  options: ShikiHighlighterPluginOptions,
): EditorHighlighterProvider {
  const owner = options.workerOwner ?? defaultShikiWorkerOwner()
  const registrations = createRegistrationCache(options)
  return {
    loadTheme: () => loadConfiguredTheme(options, registrations, owner),
    createSession: (sessionOptions) => createSession(sessionOptions, options, registrations, owner),
  }
}

const defaultShikiWorkerOwner = (): ShikiWorkerOwner => {
  const state = globalThis as Record<PropertyKey, unknown>
  const existing = state[DEFAULT_SHIKI_WORKER_OWNER_KEY] as ShikiWorkerOwner | undefined
  if (existing) return existing

  const owner = createShikiWorkerOwner()
  state[DEFAULT_SHIKI_WORKER_OWNER_KEY] = owner
  return owner
}

const createSession = (
  sessionOptions: EditorHighlighterSessionOptions,
  pluginOptions: ShikiHighlighterPluginOptions,
  registrations: ShikiRegistrationCache,
  owner: ShikiWorkerOwner,
) => {
  if (!owner.canUseWorker()) return null

  const lang = shikiLanguageForDocument(sessionOptions, pluginOptions.languages)
  if (!lang) return null

  const theme = shikiThemeName(pluginOptions)

  return owner.createSession({
    ...sessionOptions,
    lang,
    theme,
    onDidChangeTheme: pluginOptions.onThemeChanged,
    resolveTheme: (currentTheme) => {
      const nextTheme = shikiThemeName(pluginOptions)
      if (nextTheme === currentTheme) return null

      return {
        theme: nextTheme,
        registrations: resolveDocumentRegistrations(null, nextTheme, pluginOptions, registrations),
      }
    },
    registrations: resolveDocumentRegistrations(lang, theme, pluginOptions, registrations),
    preloadRegistrations: () =>
      resolvePreloadRegistrations(lang, theme, pluginOptions, registrations),
  } satisfies ShikiHighlighterSessionOptions)
}

const loadConfiguredTheme = (
  options: ShikiHighlighterPluginOptions,
  registrations: ShikiRegistrationCache,
  owner: ShikiWorkerOwner,
) => {
  const theme = shikiThemeName(options)
  return owner.loadTheme({
    theme,
    registrations: resolveDocumentRegistrations(null, theme, options, registrations),
    preloadRegistrations: () => resolveThemePreload(theme, options, registrations),
  })
}

const preloadThemes = (options: ShikiHighlighterPluginOptions): readonly string[] | undefined => {
  const themes = options.preloadThemes
  if (typeof themes === 'function') return themes()

  return themes
}

const shikiThemeName = (options: ShikiHighlighterPluginOptions): string => {
  const theme = options.theme
  if (typeof theme === 'function') return theme()

  return theme ?? DEFAULT_THEME
}

/**
 * The Shiki grammar a document uses: an explicit map entry, then its extension (`.tsx`, `.jsx`),
 * then the default map. Hosts that choose grammars ahead of a document use the same answer.
 */
export const shikiLanguageForDocument = (
  options: Pick<EditorHighlighterSessionOptions, 'documentId' | 'languageId'>,
  languages: ShikiLanguageMap | undefined,
): string | null => {
  if (!options.languageId) return null

  const configured = languages?.[options.languageId]
  if (configured) return configured

  const extensionLang = shikiLanguageForDocumentExtension(options.documentId, options.languageId)
  return extensionLang ?? DEFAULT_LANGUAGE_MAP[options.languageId] ?? null
}

const preloadLanguages = (
  lang: string,
  options: ShikiHighlighterPluginOptions,
): readonly string[] => {
  const languages = options.preloadLanguages
  const extra = typeof languages === 'function' ? languages() : languages
  return [lang, ...Array.from(extra ?? [])]
}

type ShikiRegistrationCache = {
  readonly loadedThemes: (themes: readonly string[]) => readonly ShikiWorkerThemeRegistration[]
  readonly resolveLanguage: ShikiLanguageRegistrationResolver
  readonly resolveTheme: ShikiThemeRegistrationResolver
}

const createRegistrationCache = (
  options: ShikiHighlighterPluginOptions,
): ShikiRegistrationCache => {
  const languagePromises = new Map<string, Promise<readonly ShikiWorkerLanguageRegistration[]>>()
  const themePromises = new Map<string, Promise<ShikiWorkerThemeRegistration>>()
  const loadedThemes = new Map<string, ShikiWorkerThemeRegistration>()

  const resolveLanguage = (language: string) => {
    const existing = languagePromises.get(language)
    if (existing) return existing

    const pending = options.resolveLanguage(language).then((registrations) => {
      assertLanguageRegistrations(language, registrations)
      return registrations
    })
    languagePromises.set(language, pending)
    void pending.catch(() => languagePromises.delete(language))
    return pending
  }

  const resolveTheme = (theme: string) => {
    const existing = themePromises.get(theme)
    if (existing) return existing

    const pending = options.resolveTheme(theme).then((registration) => {
      if (!registration.name) {
        throw new Error('Shiki theme registrations require a non-empty name')
      }
      loadedThemes.set(theme, registration)
      return registration
    })
    themePromises.set(theme, pending)
    void pending.catch(() => themePromises.delete(theme))
    return pending
  }

  return {
    loadedThemes: (themes) =>
      uniqueThemeRegistrations(themes.flatMap((theme) => loadedThemes.get(theme) ?? [])),
    resolveLanguage,
    resolveTheme,
  }
}

const resolveDocumentRegistrations = async (
  language: string | null,
  theme: string,
  options: ShikiHighlighterPluginOptions,
  cache: ShikiRegistrationCache,
): Promise<ShikiResolvedRegistrations> => {
  // The session's own grammar only: the preload set reaches the worker through `preload`, and
  // carrying it here made every open wait on grammars it does not use.
  const languageRegistrations = language ? await cache.resolveLanguage(language) : []
  const themeRegistration = await cache.resolveTheme(theme)
  const preloadThemeNames = [theme, ...(preloadThemes(options) ?? [])]

  return {
    languageRegistrations: uniqueLanguageRegistrations(languageRegistrations),
    themeRegistration,
    themeRegistrations: uniqueThemeRegistrations([
      themeRegistration,
      ...cache.loadedThemes(preloadThemeNames),
    ]),
  }
}

const resolvePreloadRegistrations = async (
  language: string,
  theme: string,
  options: ShikiHighlighterPluginOptions,
  cache: ShikiRegistrationCache,
): Promise<ShikiPreloadRegistrations> => {
  const [languageRegistrations, themeRegistrations] = await Promise.all([
    Promise.all(preloadLanguages(language, options).map(cache.resolveLanguage)),
    Promise.all([theme, ...(preloadThemes(options) ?? [])].map(cache.resolveTheme)),
  ])

  return {
    languageRegistrations: uniqueLanguageRegistrations(languageRegistrations.flat()),
    themeRegistrations: uniqueThemeRegistrations(themeRegistrations),
  }
}

const resolveThemePreload = async (
  theme: string,
  options: ShikiHighlighterPluginOptions,
  cache: ShikiRegistrationCache,
): Promise<ShikiPreloadRegistrations> => ({
  languageRegistrations: [],
  themeRegistrations: uniqueThemeRegistrations(
    await Promise.all([theme, ...(preloadThemes(options) ?? [])].map(cache.resolveTheme)),
  ),
})

const assertLanguageRegistrations = (
  language: string,
  registrations: readonly ShikiWorkerLanguageRegistration[],
): void => {
  if (registrations.length === 0) {
    throw new Error(`Shiki language resolver returned no registrations for ${language}`)
  }
  if (registrations.every((registration) => registration.name && registration.scopeName)) return

  throw new Error(`Shiki language resolver returned an invalid registration for ${language}`)
}

const uniqueLanguageRegistrations = (
  registrations: readonly ShikiWorkerLanguageRegistration[],
): readonly ShikiWorkerLanguageRegistration[] =>
  uniqueBy(registrations, (registration) => `${registration.name}\u0000${registration.scopeName}`)

const uniqueThemeRegistrations = (
  registrations: readonly ShikiWorkerThemeRegistration[],
): readonly ShikiWorkerThemeRegistration[] =>
  uniqueBy(registrations, (registration) => JSON.stringify(registration))

const uniqueBy = <T>(items: readonly T[], keyFor: (item: T) => string): readonly T[] => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (seen.has(key)) continue

    seen.add(key)
    unique.push(item)
  }
  return unique
}

const shikiLanguageForDocumentExtension = (
  documentId: string,
  languageId: EditorSyntaxLanguageId,
): string | null => {
  const extension = extensionForDocumentId(documentId)
  if (languageId === 'typescript' && extension === '.tsx') return 'tsx'
  if (languageId === 'javascript' && extension === '.jsx') return 'jsx'
  return null
}

const extensionForDocumentId = (documentId: string): string | null => {
  const path = documentId.split(/[?#]/, 1)[0] ?? documentId
  const slashIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex <= slashIndex) return null
  return path.slice(dotIndex).toLowerCase()
}
