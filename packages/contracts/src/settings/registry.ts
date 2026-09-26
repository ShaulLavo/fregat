import type { WallpaperSelection } from '../themes/wallpaper'
import * as v from 'valibot'
import { isRecord } from '@workspace/utils/objects'
import type { ModelRef, ProviderInstanceConfig } from '../settings'
import type { MachineDefinition } from '../machines'

/**
 * A dotted key, lowercase-ish, with no empty segments. Deliberately rejects the
 * `[language]` bracket form: language-specific overrides are not part of this
 * design, and a key shaped like one would parse here and mean nothing later.
 */
const SETTING_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/

/**
 * Where a value is allowed to come from.
 *
 * This is a security boundary before it is an ergonomics one. A workspace file
 * ships inside a cloned repository, so it is attacker-controlled input, and the
 * scope is the only thing standing between a repo and the values it can set.
 *
 * - `application` — the user file only. App-wide, no per-project meaning.
 * - `machine` — the user file only, and machine-specific: paths, binaries,
 *   window chrome. Never synced even if syncing arrives.
 * - `window` — the user file or a workspace file.
 * - `resource` — as `window`; reserved for per-file/per-language keys.
 *
 * The rule that decides between them: a value reaching **execution** — selecting
 * a binary, setting env, becoming a flag name, or binding a key — is
 * `application` or `machine`, never `window`. A value reaching only
 * **suppression** — a data operand after a fixed flag, worst case hiding
 * results — may be `window`, and then it must be visibly indicated when a
 * workspace sets it.
 */
export type SettingScope = 'application' | 'machine' | 'window' | 'resource'

/** Which control the settings page renders. Presentation only; never affects resolution. */
export type SettingWidget =
  | 'boolean'
  | 'font'
  | 'code-theme'
  | 'palette'
  | 'theme'
  | 'wallpaper'
  | 'number'
  | 'string'
  | 'multiline'
  | 'enum'
  | 'list'
  | 'record'
  | 'keybindings'
  | 'providers'
  | 'models'
  | 'machines'
  | 'complex'

/**
 * `user` is the default page. `advanced` is searchable but collapsed. `internal`
 * is reachable only through the JSON view — it exists so an engineering constant
 * can be overridable and greppable without cluttering the page.
 */
type SettingVisibility = 'user' | 'advanced' | 'internal'

/**
 * Which widget kinds can render a value of type `TValue`.
 *
 * The registry types `default` against `schema`; this does the same for the
 * control, so `{ schema: v.boolean(), widget: 'font' }` stops being a legal
 * entry that ships a control unable to render its own value.
 *
 * `complex` is always allowed. It is the escape hatch — the page renders the
 * "edit in settings.json" hint for it — and a type that cannot say "none of
 * these fit" is a cage rather than a contract.
 *
 * `unknown extends TValue` is the fallback for the unparameterised
 * `SettingDescriptor`, whose `v.InferOutput<v.GenericSchema>` is `unknown`.
 * Without it `SettingsRegistryShape` would admit no widget at all.
 */
export type WidgetFor<TValue> = unknown extends TValue
  ? SettingWidget
  : 'complex' | ValueWidget<TValue>

type ValueWidget<TValue> =
  | (TValue extends import('../themes/bundle').ThemeBundle | null ? 'theme' : never)
  | (TValue extends WallpaperSelection ? 'wallpaper' : never)
  | (TValue extends boolean ? 'boolean' : never)
  | (TValue extends number ? 'number' : never)
  | (TValue extends string
      ? 'string' | 'multiline' | 'font' | 'enum' | 'code-theme' | 'palette'
      : never)
  | (TValue extends readonly unknown[] ? 'list' : never)
  | (TValue extends readonly ProviderInstanceConfig[] ? 'providers' : never)
  | (TValue extends readonly ModelRef[] ? 'models' : never)
  | (TValue extends Readonly<Record<string, MachineDefinition>> ? 'machines' : never)
  | (TValue extends Readonly<Record<string, string | null>> ? 'record' : never)
  | (TValue extends Readonly<Record<string, readonly string[] | null>> ? 'keybindings' : never)

/**
 * How two layers combine for one key.
 *
 * `replace` is right for almost everything: a later layer wins outright.
 * `record` is opt-in for keyed maps where a workspace should be able to add an
 * entry without erasing the user's — `keybindings.overrides` is the case that
 * motivates it.
 */
type SettingMerge = 'replace' | 'record'

export type SettingDescriptor<TSchema extends v.GenericSchema = v.GenericSchema> = {
  /** Validates a stored value. Also the source of the key's TypeScript type. */
  readonly schema: TSchema
  /**
   * Bound to `schema` on purpose: `v.InferOutput<TSchema>` makes a mistyped
   * default a compile error rather than a runtime surprise on first read.
   */
  readonly default: v.InferOutput<TSchema>
  readonly scope: SettingScope
  readonly widget: SettingWidget
  /** Groups the key on the page. Explicit, so a rename cannot silently regroup it. */
  readonly category: string
  readonly description: string
  /**
   * Why the default is what it is, when that rests on a measurement, a trade-off
   * or a server quirk: short paragraphs separated by a blank line, facts with
   * their source. The row shows it behind an info icon; a self-explanatory key
   * has none.
   */
  readonly details?: string
  /**
   * The row's human name. Defaults to the humanized id, which is right for
   * almost every key.
   *
   * Set it when the id is shaped by storage rather than by the decision the user
   * is making. `models.hidden` is the case: it is a denylist because that is the
   * only shape where a model the provider adds later stays visible, but a row
   * titled "Hidden" carrying switches that are on for visible models reads as a
   * contradiction. The id is still shown next to the title, so the file stays
   * findable from the page.
   */
  readonly title?: string
  /**
   * Another key's row edits this one too, so this key gets no row of its own.
   *
   * For the case where two keys are one decision: `models.hidden` and
   * `models.order` are both answered per model, and separate rows meant the same
   * catalogue rendered twice on one page with the user holding the mapping
   * between the two lists in their head.
   *
   * A `SettingId` in spirit, typed as `string` because this type is what *builds*
   * the registry `SettingId` is derived from. `registryProblems` checks it names
   * a real key, so the looser type costs nothing.
   */
  readonly rowOwner?: string
  /**
   * A boolean key this one is a sub-option of. The page indents the row under it
   * and disables it while the parent is off, and the resolver reads a boolean
   * child as `false` then, so a consumer checks one key. A non-boolean child keeps
   * its value: only code that already checks the parent reads it.
   */
  readonly dependsOn?: string
  readonly visibility?: SettingVisibility
  readonly merge?: SettingMerge
  /** Extra words the page's search should match beyond id, category and description. */
  readonly keywords?: readonly string[]
  /** The value is never logged, never served, and never written to the settings file. */
  readonly sensitive?: boolean
  /** Changing it does nothing until the app or server restarts; the page must say so. */
  readonly requiresRestart?: boolean
  /** Shown but not editable, with this as the stated reason. */
  readonly readOnlyReason?: string
  /** Why the key still exists and what replaced it. */
  readonly deprecationReason?: string
}

/**
 * Identity function whose only job is to bind `default` and `widget` to `schema`.
 *
 * Written as a per-entry generic rather than a constraint on the whole table:
 * a whole-map `Record<string, SettingDescriptor<unknown>>` constraint widens
 * `default` to `unknown` and then accepts `{ schema: v.boolean(), default: 3 }`
 * without complaint. Per-entry, that is a type error at the call site.
 *
 * The widget binding lives on the *parameter* rather than on
 * `SettingDescriptor.widget`. A conditional type is unmeasurable for variance,
 * so putting `WidgetFor<v.InferOutput<TSchema>>` on the field makes `TSchema`
 * invariant and every entry stops satisfying
 * `Readonly<Record<string, SettingDescriptor>>`. Constraining the argument
 * catches the same mistake at the same place and leaves the descriptor type
 * assignable.
 */
export function defineSetting<TSchema extends v.GenericSchema>(
  descriptor: SettingDescriptor<TSchema> & { readonly widget: WidgetFor<v.InferOutput<TSchema>> },
): SettingDescriptor<TSchema> {
  return descriptor
}

export type SettingsRegistryShape = Readonly<Record<string, SettingDescriptor>>

/**
 * The typed document a registry produces. `SettingsValues` is this applied to
 * the real table; the resolver is generic over it so it can be exercised
 * against a fixture registry with scopes the shipping table does not yet use.
 */
export type RegistryValues<TRegistry extends SettingsRegistryShape> = {
  [K in keyof TRegistry]: v.InferOutput<TRegistry[K]['schema']>
}

export type RegistryProblem = {
  readonly id: string
  readonly reason: string
}

/**
 * Checks what the type system cannot.
 *
 * Duplicate ids need no check — they are object literal keys, so the compiler
 * rejects them. What survives compilation is a malformed id and a default that
 * satisfies the *type* but fails the schema's own refinements (`v.maxLength`,
 * `v.regex`, a `v.check` on a list). Both are caught here, and a test calls this
 * so the failure lands at `bun run test` rather than on a user's first read.
 *
 * Not run at module load: the package declares `sideEffects: false`, and a
 * throwing import would make that a lie.
 */
export function registryProblems(registry: SettingsRegistryShape): RegistryProblem[] {
  const problems: RegistryProblem[] = []

  for (const [id, descriptor] of Object.entries(registry)) {
    if (!SETTING_ID_PATTERN.test(id)) {
      problems.push({ id, reason: 'id must be dotted lowerCamel segments, e.g. editor.fontSize' })
    }

    const parsed = v.safeParse(descriptor.schema, descriptor.default)
    if (!parsed.success) {
      problems.push({ id, reason: `default does not parse: ${v.summarize(parsed.issues)}` })
    }

    if (descriptor.details !== undefined && descriptor.details.trim() === '') {
      problems.push({ id, reason: 'details must be omitted when there is nothing to say' })
    }

    if (descriptor.merge === 'record' && !isRecord(descriptor.default)) {
      problems.push({ id, reason: "merge: 'record' requires an object default" })
    }

    problems.push(...rowOwnerProblems(registry, id, descriptor))
    problems.push(...dependsOnProblems(registry, id, descriptor))
  }

  return problems
}

/**
 * A `rowOwner` that names nothing is a key with no row at all — invisible on the
 * page and unreachable from it, which is the one failure this field can cause
 * and the one a reader of the registry cannot see.
 */
function rowOwnerProblems(
  registry: SettingsRegistryShape,
  id: string,
  descriptor: SettingDescriptor,
): RegistryProblem[] {
  const owner = descriptor.rowOwner
  if (owner === undefined) return []
  if (owner === id) return [{ id, reason: 'rowOwner cannot name its own key' }]

  const target = registry[owner]
  if (!target) return [{ id, reason: `rowOwner names an unregistered key: ${owner}` }]

  // One hop only. A chain would need the page to resolve it transitively, and
  // the field exists for two keys sharing one control, not for a hierarchy.
  if (target.rowOwner !== undefined) {
    return [{ id, reason: `rowOwner must name a key that owns its own row: ${owner} does not` }]
  }

  return []
}

/**
 * A parent the page cannot place the child under, or one with no "off", would
 * leave the child disabled forever or indented under nothing.
 */
function dependsOnProblems(
  registry: SettingsRegistryShape,
  id: string,
  descriptor: SettingDescriptor,
): RegistryProblem[] {
  const parentId = descriptor.dependsOn
  if (parentId === undefined) return []
  if (parentId === id) return [{ id, reason: 'dependsOn cannot name its own key' }]

  const parent = registry[parentId]
  if (!parent) return [{ id, reason: `dependsOn names an unregistered key: ${parentId}` }]
  if (typeof parent.default !== 'boolean') {
    return [{ id, reason: `dependsOn must name a boolean key: ${parentId} is not` }]
  }
  // One level: the page indents once, and the resolver reads each parent once.
  if (parent.dependsOn !== undefined) {
    return [{ id, reason: `dependsOn must name a top-level key: ${parentId} depends on another` }]
  }
  if (parent.category !== descriptor.category) {
    return [{ id, reason: `dependsOn must name a key in the same category: ${parentId} is not` }]
  }
  if (descriptor.rowOwner !== undefined || parent.rowOwner !== undefined) {
    return [{ id, reason: 'dependsOn needs both keys to own their rows' }]
  }

  return []
}

/**
 * Reads each boolean child as `false` while its parent is `false`. Mutates
 * `values`, which must already hold every key of `registry`.
 */
export function applySettingDependencies(
  registry: SettingsRegistryShape,
  values: Record<string, unknown>,
): void {
  for (const [id, descriptor] of Object.entries(registry)) {
    if (descriptor.dependsOn === undefined) continue
    if (typeof values[id] !== 'boolean') continue
    if (values[descriptor.dependsOn] !== false) continue

    values[id] = false
  }
}
