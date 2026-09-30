import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  editorThemeToShikiTheme,
  type ShikiWorkerThemeRegistration,
  type VscodeThemeRegistration,
} from '@singapore-editor/core/shiki'

/** Theme data for a highlight: an Editor palette or an imported VS Code theme. */
export type HighlightTheme =
  | { readonly format: 'editor'; readonly definition: EditorTheme; readonly name?: string }
  | { readonly format: 'vscode'; readonly definition: VscodeThemeRegistration }

export type ResolvedHighlightTheme = {
  /** Changes whenever the theme's content changes, not only its name. */
  readonly revision: string
  readonly registration: ShikiWorkerThemeRegistration
}

const revisions = new WeakMap<object, ResolvedHighlightTheme>()

export function resolveHighlightTheme(theme: HighlightTheme): ResolvedHighlightTheme {
  const cached = revisions.get(theme)
  if (cached) return cached

  const registration = themeRegistration(theme)
  // A palette's contributed colors never reach the TextMate conversion, so its revision hashes
  // the palette itself.
  const content = theme.format === 'editor' ? theme.definition : registration
  const revision = `${registration.name}@${contentHash(JSON.stringify(content))}`
  const resolved = { revision, registration }
  revisions.set(theme, resolved)
  return resolved
}

/** A registration Shiki may normalize in place: owned arrays, no undefined colors. */
export function workerThemeRegistration(
  registration: VscodeThemeRegistration,
  name = registration.name,
): ShikiWorkerThemeRegistration {
  if (!name) throw new Error('Highlight themes require a name')

  return {
    ...registration,
    name,
    colors: definedColors(registration.colors),
    settings: registration.settings?.map(copyThemeSetting),
    tokenColors: registration.tokenColors?.map(copyThemeSetting),
  } as ShikiWorkerThemeRegistration
}

function themeRegistration(theme: HighlightTheme): ShikiWorkerThemeRegistration {
  if (theme.format === 'vscode') return workerThemeRegistration(theme.definition)

  const name = theme.name ?? 'editor'
  const type = theme.definition.type === 'light' ? 'light' : 'dark'
  return workerThemeRegistration(editorThemeToShikiTheme(theme.definition, { name, type }), name)
}

type ThemeSetting = NonNullable<VscodeThemeRegistration['tokenColors']>[number]

function copyThemeSetting(setting: ThemeSetting) {
  return {
    ...setting,
    scope: typeof setting.scope === 'string' ? setting.scope : setting.scope?.slice(),
    settings: { ...setting.settings },
  }
}

function definedColors(source: VscodeThemeRegistration['colors']): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const [name, color] of Object.entries(source ?? {})) {
    if (color === undefined) continue
    colors[name] = color
  }
  return colors
}

// FNV-1a: a revision tag, not a security boundary.
function contentHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
