import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  editorThemeFromVscodeTheme,
  VSCODE_THEMES,
  type VscodeThemeDefinition,
  type VscodeThemeRegistration,
} from '@singapore-editor/core/shiki'
import type { ShikiWorkerThemeRegistration } from '@singapore-editor/core/shiki'

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
const editorColorThemeListeners = new Set<() => void>()

let selectionByColorMode: Record<EditorColorMode, string> | null = null
let activeEditorColorMode: EditorColorMode = 'dark'
// Preview overlays settings until selection or palette close.
let previewTheme: { readonly colorMode: EditorColorMode; readonly themeId: string } | null = null

/**
 * The theme id the editor/highlighter should render right now — the hover-preview
 * when one is active, otherwise the committed selection. Used by the shiki
 * plugin's theme resolver and by surfaces that follow live preview.
 */
export function getSelectedEditorThemeId(colorMode: EditorColorMode): string {
  if (previewTheme?.colorMode === colorMode) return previewTheme.themeId
  return readSelectionByColorMode()[colorMode]
}

/**
 * The persisted selection only — ignores any active hover-preview. Used by the
 * palette's "active" badge so it tracks what the user committed, not the row
 * currently under the pointer.
 */
export function getCommittedEditorThemeId(colorMode: EditorColorMode): string {
  return readSelectionByColorMode()[colorMode]
}

export function syncEditorThemeSelection(colorMode: EditorColorMode, themeId: string) {
  const selection = readSelectionByColorMode()
  themeId = validThemeIdForColorMode(colorMode, themeId)
  if (selection[colorMode] === themeId) return

  // A commit supersedes the pending preview in its own mode.
  if (previewTheme?.colorMode === colorMode) {
    previewTheme = null
  }

  selectionByColorMode = { ...selection, [colorMode]: themeId }
  notifyEditorColorThemeListeners()
  void ensureRegistrationLoaded(themeId)
}

export function previewEditorTheme(colorMode: EditorColorMode, themeId: string) {
  if (editorThemeColorMode(themeId) !== colorMode) return
  if (previewTheme?.colorMode === colorMode && previewTheme.themeId === themeId) return
  if (previewTheme === null && readSelectionByColorMode()[colorMode] === themeId) return

  previewTheme = { colorMode, themeId }
  notifyEditorColorThemeListeners()
  void ensureRegistrationLoaded(themeId)
}

export function clearEditorThemePreview() {
  if (previewTheme === null) return

  previewTheme = null
  notifyEditorColorThemeListeners()
}

/**
 * Whether the active selection is painted by shiki. The built-in themes color
 * tree-sitter captures instead, and tree-sitter only emits highlights while no
 * highlighter session exists — so this is what decides whether the shiki
 * highlighter is registered at all.
 */
export function activeEditorThemeUsesShiki(): boolean {
  return !isBuiltinEditorThemeId(getSelectedEditorThemeId(activeEditorColorMode))
}

/**
 * The shiki theme name for the active color mode. Falls back to that mode's
 * default when a built-in theme is selected, so a resolver call that races the
 * highlighter's deregistration can never hand the worker a name it cannot
 * resolve.
 */
export function activeShikiThemeId(): string {
  const themeId = getSelectedEditorThemeId(activeEditorColorMode)
  if (vscodeThemeDefinitionById.has(themeId)) return themeId

  return DEFAULT_DEFINITION_BY_COLOR_MODE[activeEditorColorMode].id
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
  editorColorThemeListeners.add(listener)

  return () => {
    editorColorThemeListeners.delete(listener)
  }
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
  return activeEditorColorMode
}

export function setActiveEditorColorMode(colorMode: EditorColorMode) {
  if (activeEditorColorMode === colorMode) return

  activeEditorColorMode = colorMode
  notifyEditorColorThemeListeners()
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
  selectionByColorMode = null
  activeEditorColorMode = 'dark'
  previewTheme = null
  resourceQueryClient.removeQueries({ queryKey: editorQueryKeys.themes })
  resourceQueryClient.removeQueries({ queryKey: codeThemeQueryKeys.registrations })
  editorColorThemeListeners.clear()
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
        if (themeIdIsCurrentlySelected(definition.id)) notifyEditorColorThemeListeners()
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
    if (!silent && themeIdIsCurrentlySelected(themeId)) notifyEditorColorThemeListeners()
  } catch (error) {
    log.error({ action: 'editor.color-theme.preview_load_failed', area: 'editor', themeId, error })
  }
}

function readSelectionByColorMode(): Record<EditorColorMode, string> {
  if (selectionByColorMode) return selectionByColorMode

  selectionByColorMode = {
    dark: persistedThemeIdForColorMode('dark'),
    light: persistedThemeIdForColorMode('light'),
  }
  return selectionByColorMode
}

function persistedThemeIdForColorMode(colorMode: EditorColorMode): string {
  const settings = readSettingsMirror()
  return validThemeIdForColorMode(colorMode, settings[`editor.codeTheme.${colorMode}`])
}

function validThemeIdForColorMode(colorMode: EditorColorMode, themeId: string): string {
  if (editorThemeColorMode(themeId) === colorMode) return themeId
  return DEFAULT_DEFINITION_BY_COLOR_MODE[colorMode].id
}

function notifyEditorColorThemeListeners() {
  for (const listener of editorColorThemeListeners) listener()
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
