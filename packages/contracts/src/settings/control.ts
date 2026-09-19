import { wallpaperSelectionSchema, type WallpaperSelection } from '../themes/wallpaper'
import * as v from 'valibot'
import { isRecord } from '../is-record'
import { providerInstanceConfigsSchema, type ProviderInstanceConfig } from '../settings'
import { descriptorFor, type SettingId, type SettingValue } from './keys'

/**
 * What the record widget can edit: string keys to a string or an explicit
 * unbind. This is the widget's own input contract, not a copy of any key's
 * schema — `keybindings.overrides` is the only key using it today and its
 * schema is narrower (a command-id pattern, a trimmed non-empty value).
 */
const recordControlSchema = v.record(v.string(), v.nullable(v.string()))

/**
 * One registry entry plus its current value, narrowed to the control that can
 * render it.
 *
 * The page used to do this narrowing itself with eight `as` casts, including
 * `onChange: (next: never) => void` — which is the wrong direction: a handler
 * that accepts nothing is assignable to no widget, where a handler accepting
 * every registered value type is assignable to all of them. Narrowing here
 * means the page dispatches once and the compiler checks each branch.
 *
 * `unsupported` covers `list`, `complex`, and a value whose shape does not
 * match its widget. The last is not a live path — the resolver rejects a layer
 * value that fails its schema and reports it as a diagnostic instead of
 * applying it — but this function has to be total, and a JSON hint beats a
 * control that silently coerces.
 */
export type SettingControl =
  | { readonly widget: 'theme' }
  | { readonly widget: 'wallpaper'; readonly value: WallpaperSelection }
  | { readonly widget: 'boolean'; readonly value: boolean }
  | { readonly widget: 'number'; readonly value: number }
  | { readonly widget: 'string' | 'multiline'; readonly value: string }
  | { readonly widget: 'font'; readonly value: string }
  | { readonly widget: 'code-theme'; readonly value: string }
  | { readonly widget: 'palette'; readonly value: string }
  | { readonly widget: 'enum'; readonly value: string; readonly options: readonly string[] }
  | { readonly widget: 'record'; readonly value: Record<string, string | null> }
  | { readonly widget: 'keybindings' }
  | { readonly widget: 'providers'; readonly value: readonly ProviderInstanceConfig[] }
  | { readonly widget: 'models' }
  | { readonly widget: 'machines' }
  | { readonly widget: 'unsupported' }

export function settingControl(id: SettingId, value: SettingValue<SettingId>): SettingControl {
  const { schema, widget } = descriptorFor(id)

  if (widget === 'theme') return { widget }
  if (widget === 'wallpaper') {
    const parsed = v.safeParse(wallpaperSelectionSchema, value)
    return parsed.success ? { widget, value: parsed.output } : { widget: 'unsupported' }
  }
  if (widget === 'boolean') return { widget, value: value === true }
  if (widget === 'number') {
    return typeof value === 'number' ? { widget, value } : { widget: 'unsupported' }
  }
  if (widget === 'font' || widget === 'code-theme' || widget === 'palette') {
    return typeof value === 'string' ? { widget, value } : { widget: 'unsupported' }
  }
  if (widget === 'string' || widget === 'multiline') {
    return typeof value === 'string' ? { widget, value } : { widget: 'unsupported' }
  }
  if (widget === 'enum') {
    if (typeof value !== 'string') return { widget: 'unsupported' }

    return { widget, value, options: picklistOptions(schema) }
  }
  if (widget === 'record') {
    const parsed = v.safeParse(recordControlSchema, value ?? {})

    return parsed.success ? { widget, value: parsed.output } : { widget: 'unsupported' }
  }
  // Like `models`: the keybinding list resolves every command against the live
  // keymap and reads the overrides itself, so a parsed copy of the stored record
  // here would be a second representation nothing reads.
  if (widget === 'keybindings') return { widget }
  if (widget === 'providers') {
    const parsed = v.safeParse(providerInstanceConfigsSchema, value)

    return parsed.success ? { widget, value: parsed.output } : { widget: 'unsupported' }
  }
  // The model catalogue is not in the settings document, so the control sources
  // its own rows and the stored value tells it nothing.
  if (widget === 'models') return { widget }
  if (widget === 'machines') return { widget }

  return { widget: 'unsupported' }
}

/**
 * A picklist's members, which is where an enum control's options come from.
 *
 * Read here rather than by the page: `options` is a valibot implementation
 * detail, and reaching for it through a cast was how the page erased the
 * literal union and could hand a select a value the schema would reject.
 */
function picklistOptions(schema: unknown): readonly string[] {
  if (!isRecord(schema)) return []
  const { options } = schema
  if (!Array.isArray(options)) return []

  return options.map(String)
}
