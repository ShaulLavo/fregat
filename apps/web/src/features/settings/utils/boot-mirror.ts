import {
  descriptorFor,
  resolveThemeSettings,
  variantFromSettings,
  type SettingsLayer,
  DEFAULT_SETTING_VALUES,
  type SettingId,
  type SettingsValues,
} from '@workspace/contracts'
import * as v from 'valibot'

/**
 * Also mirrored, though they are not appearance: the editor's plugin list is
 * built outside React, at module scope, so it cannot read a React query. The
 * mirror is the only synchronous source of the user's choice at that point.
 */

// Also read inline by the boot script in apps/web/index.html, which runs
// before any module can load — renaming the key means changing both.
const BOOT_MIRROR_KEY = 'platform.settings-boot-mirror.v1'

/**
 * The keys readable synchronously, outside React.
 *
 * Two jobs, both of which a React query cannot do. First, appearance has to be
 * right *before the first paint*, and a fetch cannot be. Second, some consumers
 * are not components at all — the editor's plugin list is a module-level
 * singleton, and the search limits are read inside async generators — so they
 * need a value they can read at call time.
 *
 * It stays a mirror, never a source: rewritten from every server snapshot, so a
 * read here is live rather than merely boot-time, and never authority.
 */
const MIRRORED_KEYS = [
  'editor.codeTheme.dark',
  'editor.codeTheme.light',
  'environments.machines',
  'editor.decode.mode',
  'editor.fontFamily',
  'editor.fontSize',
  'editor.lineHeight',
  'editor.guides.indentation',
  'editor.minimap.enabled',
  'editor.retainedTextBudget',
  'editor.history.retainedStates',
  'editor.syntaxHighlighting.enabled',
  'editor.tabSize',
  'logs.defaultTimeRange',
  'logs.slowThresholdMs',
  // The semantic-token controller is a plain object hanging off an LSP
  // connection, not a component, and it re-reads these on every request so the
  // switch takes effect without reconnecting. That is the second job above.
  'lsp.semanticTokens.enabled',
  'lsp.semanticTokens.servers',
  'search.caseSensitive',
  'search.defaultMatchMode',
  'search.maxResults',
  'search.maxResultFiles',
  'search.quickOpenLimit',
  'search.wholeWord',
  'workbench.theme',
  'workbench.theme.customizations',
  'workbench.palette',
  'workbench.colorTheme',
  'workbench.density',
  'workbench.surface.blur',
  'workbench.surface.contentOpacity',
  'workbench.surface.opacity',
  'workbench.surface.saturation',
  'workbench.tree.indentGuides',
  'workbench.wallpaper',
] as const satisfies readonly (keyof SettingsValues)[]

/**
 * A cache of the last server-sourced appearance values, read synchronously at
 * boot so the app does not paint with the wrong theme while a fetch is in
 * flight.
 *
 * Emphatically not a layer: it is never authority after hydration, it is never
 * written from an optimistic value — a failed write would otherwise leave the
 * wrong value to survive the next reload — and a key it cannot validate simply
 * falls back to the registry default.
 */
export function readSettingsMirror(): MirroredValues {
  const stored = parseStored()

  // Validated per key rather than as a whole document. A whole-document parse
  // fails the moment any key is added or removed, which would make the first
  // cold boot after every deploy flash the defaults — exactly the boots where
  // people notice.
  const values = {} as Record<string, unknown>
  for (const key of MIRRORED_KEYS) {
    values[key] = validValue(key, stored[key])
  }

  return resolveThemeSettings(
    values as MirroredValues,
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )
}

/** One cached startup value until the confirmed settings document arrives. */
export function readSettingBootValue<K extends SettingId>(key: K): SettingsValues[K] {
  if (!MIRRORED_KEYS.some((mirrored) => mirrored === key)) return DEFAULT_SETTING_VALUES[key]

  return validValue(key, parseStored()[key])
}

/** Called only with a snapshot the server sent. */
export function writeBootMirror(values: SettingsValues, layers: readonly SettingsLayer[] = []) {
  const theme = values['workbench.theme']
  if (theme)
    values = {
      ...values,
      'workbench.theme.customizations': {},
      'workbench.theme': {
        ...theme,
        variants: {
          light: variantFromSettings(
            resolveThemeSettings({ ...values, 'workbench.colorTheme': 'light' }, 'light', layers),
            'light',
          ),
          dark: variantFromSettings(
            resolveThemeSettings({ ...values, 'workbench.colorTheme': 'dark' }, 'dark', layers),
            'dark',
          ),
        },
      },
    }

  const mirrored: Record<string, unknown> = {}
  for (const key of MIRRORED_KEYS) mirrored[key] = values[key]

  try {
    localStorage.setItem(BOOT_MIRROR_KEY, JSON.stringify(mirrored))
  } catch {
    // A full or unavailable localStorage costs a themed first paint, nothing
    // more. The settings themselves live on the server.
  }
}

function validValue<K extends SettingId>(key: K, stored: unknown): SettingsValues[K] {
  if (stored === undefined) return DEFAULT_SETTING_VALUES[key]

  const parsed = v.safeParse(descriptorFor(key).schema, stored)
  if (!parsed.success) return DEFAULT_SETTING_VALUES[key]

  return parsed.output as SettingsValues[K]
}

function parseStored(): Record<string, unknown> {
  // This synchronous path selects the first-paint theme before React mounts.
  try {
    const raw = localStorage.getItem(BOOT_MIRROR_KEY)
    if (!raw) return {}

    const parsed: unknown = JSON.parse(raw)

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

type MirroredKey = (typeof MIRRORED_KEYS)[number]

export type MirroredValues = Pick<SettingsValues, MirroredKey>
