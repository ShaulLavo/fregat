import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  editorThemeFromVscodeTheme,
  VSCODE_THEMES,
  type VscodeThemeDefinition,
  type VscodeThemeRegistration,
} from '@singapore-editor/core/shiki'
import type { ShikiWorkerThemeRegistration } from '@singapore-editor/core/shiki'
import { createStore } from 'zustand/vanilla'

import {
  builtinEditorTheme,
  editorThemeColorMode,
  isBuiltinEditorThemeId,
  type BuiltinEditorThemeDefinition,
} from '@/lib/code-theme/utils/catalog'
import { shikiThemeContentHash } from '@/lib/code-theme/utils/content-hash'
import { themeRegistrationQueryOptions } from '@/lib/code-theme/state/registration-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { codeThemeQueryKeys } from '@/lib/code-theme/utils/query-keys'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { log } from '@/lib/client-logging'
import { clientErrors, createClientInvariantError } from '@/lib/structured-errors'

export type EditorColorMode = 'dark' | 'light'

export type LoadedEditorColorTheme = {
  /** `null` for the built-in themes: they are not backed by a VSCode theme. */
  readonly definition: VscodeThemeDefinition | null
  readonly registration: VscodeThemeRegistration | null
  readonly editorTheme: EditorTheme
  readonly resolvedThemeId: string
}

const DEFAULT_DEFINITION_BY_COLOR_MODE = {
  dark: requireVscodeThemeDefinition('dark-plus'),
  light: requireVscodeThemeDefinition('light-plus'),
} satisfies Record<EditorColorMode, VscodeThemeDefinition>

const vscodeThemeDefinitionById = new Map(VSCODE_THEMES.map((theme) => [theme.id, theme]))

type ColorThemeState = {
  /** `null` until a selection is synced; reads fall back to the settings mirror until then. */
  readonly selection: Readonly<Record<EditorColorMode, string>> | null
  readonly activeColorMode: EditorColorMode
  /** Overlays the selection until it is committed or the palette closes. */
  readonly preview: { readonly colorMode: EditorColorMode; readonly themeId: string } | null
  /** Bumps when a selected theme's registration lands, so content-hash readers re-read. */
  readonly loadedRevision: number
}

const INITIAL_STATE: ColorThemeState = {
  selection: null,
  activeColorMode: 'dark',
  preview: null,
  loadedRevision: 0,
}

export const colorThemeStore = createStore<ColorThemeState>(() => INITIAL_STATE)

/**
 * The theme id the editor/highlighter should render right now — the hover-preview
 * when one is active, otherwise the committed selection. Used by the shiki
 * plugin's theme resolver and by surfaces that follow live preview.
 */
export function getSelectedEditorThemeId(
  colorMode: EditorColorMode,
  { preview, selection } = colorThemeStore.getState(),
): string {
  if (preview?.colorMode === colorMode) return preview.themeId
  return (selection ?? persistedSelection())[colorMode]
}

/**
 * The persisted selection only — ignores any active hover-preview. Used by the
 * palette's "active" badge so it tracks what the user committed, not the row
 * currently under the pointer.
 */
export function getCommittedEditorThemeId(
  colorMode: EditorColorMode,
  { selection } = colorThemeStore.getState(),
): string {
  return (selection ?? persistedSelection())[colorMode]
}

export function syncEditorThemeSelection(colorMode: EditorColorMode, themeId: string) {
  const { preview, selection } = colorThemeStore.getState()
  const current = selection ?? persistedSelection()
  themeId = validThemeIdForColorMode(colorMode, themeId)
  if (current[colorMode] === themeId) return

  colorThemeStore.setState({
    selection: { ...current, [colorMode]: themeId },
    // A commit supersedes the pending preview in its own mode.
    preview: preview?.colorMode === colorMode ? null : preview,
  })
  void ensureRegistrationLoaded(themeId)
}

export function previewEditorTheme(colorMode: EditorColorMode, themeId: string) {
  const { preview } = colorThemeStore.getState()
  if (editorThemeColorMode(themeId) !== colorMode) return
  if (preview?.colorMode === colorMode && preview.themeId === themeId) return
  if (preview === null && getCommittedEditorThemeId(colorMode) === themeId) return

  colorThemeStore.setState({ preview: { colorMode, themeId } })
  void ensureRegistrationLoaded(themeId)
}

export function clearEditorThemePreview() {
  if (colorThemeStore.getState().preview === null) return

  colorThemeStore.setState({ preview: null })
}

/**
 * Whether the active selection is painted by shiki. The built-in themes color
 * tree-sitter captures instead, and tree-sitter only emits highlights while no
 * highlighter session exists — so this is what decides whether the shiki
 * highlighter is registered at all.
 */
export function activeEditorThemeUsesShiki(): boolean {
  return !isBuiltinEditorThemeId(getSelectedEditorThemeId(getActiveEditorColorMode()))
}

/**
 * The shiki theme name for the active color mode. Falls back to that mode's
 * default when a built-in theme is selected, so a resolver call that races the
 * highlighter's deregistration can never hand the worker a name it cannot
 * resolve.
 */
export function activeShikiThemeId(): string {
  const colorMode = getActiveEditorColorMode()
  const themeId = getSelectedEditorThemeId(colorMode)
  if (vscodeThemeDefinitionById.has(themeId)) return themeId

  return DEFAULT_DEFINITION_BY_COLOR_MODE[colorMode].id
}

/**
 * The registration the Shiki worker should use for `themeId`, if it has finished loading.
 */
export function getLoadedVscodeThemeRegistration(
  themeId: string,
): ShikiWorkerThemeRegistration | undefined {
  const registration = resourceQueryClient.getQueryData(
    themeRegistrationQueryOptions(themeId).queryKey,
  )?.registration
  if (!registration?.name) return undefined

  return registration as ShikiWorkerThemeRegistration
}

export async function resolveEditorShikiThemeRegistration(
  themeId: string,
): Promise<ShikiWorkerThemeRegistration> {
  await ensureRegistrationLoaded(themeId)
  const registration = getLoadedVscodeThemeRegistration(themeId)
  if (registration) return registration

  throw createClientInvariantError(`Shiki theme registration did not load: ${themeId}`)
}

export function getResolvedShikiThemeContentHash(themeId: string): string {
  return (
    resourceQueryClient.getQueryData(themeRegistrationQueryOptions(themeId).queryKey)
      ?.contentHash ?? shikiThemeContentHash(themeId)
  )
}

export function subscribeEditorColorTheme(listener: () => void): () => void {
  return colorThemeStore.subscribe(() => listener())
}

/** Notifies highlighters only when their effective worker configuration changes. */
export function subscribeActiveShikiTheme(listener: () => void): () => void {
  let previousSnapshot = activeShikiThemeSubscriptionSnapshot()

  return subscribeEditorColorTheme(() => {
    const nextSnapshot = activeShikiThemeSubscriptionSnapshot()
    if (nextSnapshot === previousSnapshot) return

    previousSnapshot = nextSnapshot
    listener()
  })
}

export function getActiveEditorColorMode(): EditorColorMode {
  return colorThemeStore.getState().activeColorMode
}

export function setActiveEditorColorMode(colorMode: EditorColorMode) {
  if (getActiveEditorColorMode() === colorMode) return

  colorThemeStore.setState({ activeColorMode: colorMode })
}

export function loadEditorThemeForSelection(
  colorMode: EditorColorMode,
): Promise<LoadedEditorColorTheme> {
  const themeId = getSelectedEditorThemeId(colorMode)
  const builtin = builtinEditorTheme(themeId)
  if (builtin) return loadBuiltinEditorTheme(builtin)

  const definition =
    vscodeThemeDefinitionById.get(themeId) ?? DEFAULT_DEFINITION_BY_COLOR_MODE[colorMode]

  return loadEditorTheme(definition, colorMode)
}

/** Reads a theme already loaded before the first React render. */
export function loadedEditorThemeForSelection(
  colorMode: EditorColorMode,
): LoadedEditorColorTheme | null {
  const themeId = getSelectedEditorThemeId(colorMode)
  const builtin = builtinEditorTheme(themeId)
  if (builtin)
    return {
      definition: null,
      registration: null,
      editorTheme: builtin.editorTheme,
      resolvedThemeId: builtin.id,
    }
  const definition = vscodeThemeDefinitionById.get(themeId)
  const registration = resourceQueryClient.getQueryData(
    themeRegistrationQueryOptions(themeId).queryKey,
  )?.registration
  if (!definition || !registration) return null
  return {
    definition,
    registration,
    editorTheme: editorThemeFromVscodeTheme(registration),
    resolvedThemeId: themeId,
  }
}

/** Warms bundled theme registrations so hover preview never waits on a first import. */
export function preloadVscodeThemeRegistrations(): Promise<void> {
  return Promise.all(
    VSCODE_THEMES.map((theme) => ensureRegistrationLoaded(theme.id, { silent: true })),
  ).then(() => undefined)
}

/** Test hook: drops in-memory state so the next read uses the settings mirror. */
export function resetEditorColorThemeStore() {
  colorThemeStore.setState(INITIAL_STATE, true)
  resourceQueryClient.removeQueries({ queryKey: editorQueryKeys.themes })
  resourceQueryClient.removeQueries({ queryKey: codeThemeQueryKeys.registrations })
}

function loadBuiltinEditorTheme(
  builtin: BuiltinEditorThemeDefinition,
): Promise<LoadedEditorColorTheme> {
  return resourceQueryClient.query({
    queryKey: editorQueryKeys.theme(builtin.id),
    queryFn: () => ({
      definition: null,
      editorTheme: builtin.editorTheme,
      registration: null,
      resolvedThemeId: builtin.id,
    }),
    staleTime: 'static',
    gcTime: Infinity,
    networkMode: 'always',
    structuralSharing: false,
  })
}

async function loadEditorTheme(
  definition: VscodeThemeDefinition,
  colorMode: EditorColorMode,
): Promise<LoadedEditorColorTheme> {
  try {
    return await resourceQueryClient.query({
      queryKey: editorQueryKeys.theme(definition.id),
      queryFn: async () => {
        const { registration } = await resourceQueryClient.query(
          themeRegistrationQueryOptions(definition),
        )
        if (themeIdIsCurrentlySelected(definition.id)) noteRegistrationLoaded()
        return {
          definition,
          registration,
          editorTheme: editorThemeFromVscodeTheme(registration),
          resolvedThemeId: definition.id,
        }
      },
      staleTime: 'static',
      gcTime: Infinity,
      networkMode: 'always',
      structuralSharing: false,
      retry: false,
    })
  } catch (error) {
    log.error({
      action: 'editor.color-theme.load_failed',
      area: 'editor',
      colorMode,
      themeId: definition.id,
      error,
    })
    const fallback = DEFAULT_DEFINITION_BY_COLOR_MODE[colorMode]
    if (fallback.id === definition.id) throw error
    return loadEditorTheme(fallback, colorMode)
  }
}

async function ensureRegistrationLoaded(
  themeId: string,
  { silent = false }: { readonly silent?: boolean } = {},
): Promise<void> {
  const definition = vscodeThemeDefinitionById.get(themeId)
  if (!definition) return
  const options = themeRegistrationQueryOptions(definition)
  if (resourceQueryClient.getQueryData(options.queryKey)) return
  try {
    await resourceQueryClient.query(options)
    if (!silent && themeIdIsCurrentlySelected(themeId)) noteRegistrationLoaded()
  } catch (error) {
    log.error({ action: 'editor.color-theme.preview_load_failed', area: 'editor', themeId, error })
  }
}

function persistedSelection(): Record<EditorColorMode, string> {
  return {
    dark: persistedThemeIdForColorMode('dark'),
    light: persistedThemeIdForColorMode('light'),
  }
}

function persistedThemeIdForColorMode(colorMode: EditorColorMode): string {
  const settings = readSettingsMirror()
  return validThemeIdForColorMode(colorMode, settings[`editor.codeTheme.${colorMode}`])
}

function validThemeIdForColorMode(colorMode: EditorColorMode, themeId: string): string {
  if (editorThemeColorMode(themeId) === colorMode) return themeId
  return DEFAULT_DEFINITION_BY_COLOR_MODE[colorMode].id
}

function noteRegistrationLoaded() {
  colorThemeStore.setState((state) => ({ loadedRevision: state.loadedRevision + 1 }))
}

function activeShikiThemeSubscriptionSnapshot(): string {
  const themeId = activeShikiThemeId()
  return [
    activeEditorThemeUsesShiki() ? 'shiki' : 'tree-sitter',
    themeId,
    getResolvedShikiThemeContentHash(themeId),
  ].join(':')
}

function themeIdIsCurrentlySelected(themeId: string): boolean {
  return (
    getSelectedEditorThemeId('dark') === themeId || getSelectedEditorThemeId('light') === themeId
  )
}

function requireVscodeThemeDefinition(themeId: string): VscodeThemeDefinition {
  const definition = VSCODE_THEMES.find((theme) => theme.id === themeId)
  if (!definition) {
    throw clientErrors.CLIENT_INVARIANT_ERROR({
      message: `Bundled VSCode themes are missing the default theme: ${themeId}`,
      internal: { themeId, bundled: VSCODE_THEMES.map((theme) => theme.id) },
    })
  }

  return definition
}
