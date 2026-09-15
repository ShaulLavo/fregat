import * as v from 'valibot'
import { isRecord } from '../is-record'
import { jsonEqual } from './json-equal'
import { SETTINGS_REGISTRY, type SettingId, type SettingsValues } from './keys'
import { migrateSetting } from './migrations'
import type {
  RegistryValues,
  SettingDescriptor,
  SettingScope,
  SettingsRegistryShape,
} from './registry'

/**
 * The layers, in precedence order.
 *
 * There is no `folder` layer. This app holds exactly one root at a time
 * (`rootFolder: PickedFsEntry | null`, switched wholesale), so a folder layer
 * could never disagree with the workspace layer — it would be a precedence rule
 * with no test that can exercise it.
 */
export const SETTINGS_LAYER_ORDER = ['user', 'workspace', 'policy'] as const

export type SettingsLayerId = (typeof SETTINGS_LAYER_ORDER)[number]

export type SettingsLayer = {
  readonly id: SettingsLayerId
  /**
   * Exactly what the source held, unfiltered and unvalidated.
   *
   * Kept raw on purpose: `inspect()` reports from this, so the page can say
   * "set here, not applied" about a key this layer is not allowed to set. A
   * pre-filtered layer cannot tell that from "never set at all".
   */
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * Which scopes a layer is allowed to carry.
 *
 * The workspace row is the security boundary: a workspace file ships inside a
 * cloned repository, so anything reaching execution is simply not readable from
 * there. Enforced here, once, rather than at each consumer.
 */
const SCOPES_BY_LAYER: Readonly<Record<SettingsLayerId, readonly SettingScope[]>> = {
  user: ['application', 'machine', 'window', 'resource'],
  workspace: ['window', 'resource'],
  policy: ['application', 'machine', 'window', 'resource'],
}

/**
 * Whether a layer may carry a key of this scope.
 *
 * Exported so the write guard and the page read the rule instead of restating
 * it. It is a security boundary, and a boundary with three copies of its
 * predicate is a boundary that will eventually disagree with itself.
 */
export function layerAllowsScope(layer: SettingsLayerId, scope: SettingScope): boolean {
  return SCOPES_BY_LAYER[layer].includes(scope)
}

/**
 * Tiered by blast radius, because these are not one problem.
 *
 * `unknown-key` is the quiet one: a key this build does not have is usually a
 * file written by a newer build, and `accept` deliberately leaves it in `raw` so
 * it round-trips. `migrated` and `removed-key` are keys we retired ourselves —
 * ours to explain rather than the user's to debug. Folding all of them into one
 * banner is what let a rename read as a config typo.
 */
type SettingsDiagnosticKind =
  | 'unknown-key'
  | 'scope-not-allowed'
  | 'invalid-value'
  | 'migrated'
  | 'removed-key'

/**
 * Something a layer held that did not become a value. Never thrown: one bad key
 * must not take down the document, because the document also carries the
 * keybindings the running app needs.
 */
export type SettingsDiagnostic = {
  readonly kind: SettingsDiagnosticKind
  readonly id: string
  readonly layer: SettingsLayerId
  readonly detail?: string
}

export type SettingsResolution<TValues = SettingsValues> = {
  readonly values: TValues
  readonly diagnostics: readonly SettingsDiagnostic[]
}

export type ResolveOptions<TRegistry extends SettingsRegistryShape> = {
  /** Defaults to the shipping table; tests pass a fixture to exercise other scopes. */
  readonly registry?: TRegistry
  /**
   * The previous resolution's values. Any key that resolves to an equal value
   * is handed back by reference instead of as a fresh object, so consumers that
   * diff by identity do not re-run on unrelated writes.
   */
  readonly previous?: RegistryValues<TRegistry>
}

type Contribution = {
  readonly layer: SettingsLayerId
  readonly value: unknown
}

type Acceptance =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly diagnostic: SettingsDiagnostic }

export function resolveSettings(
  layers: readonly SettingsLayer[],
  options?: ResolveOptions<typeof SETTINGS_REGISTRY>,
): SettingsResolution<SettingsValues>
export function resolveSettings<TRegistry extends SettingsRegistryShape>(
  layers: readonly SettingsLayer[],
  options: ResolveOptions<TRegistry>,
): SettingsResolution<RegistryValues<TRegistry>>
export function resolveSettings(
  layers: readonly SettingsLayer[],
  options: ResolveOptions<SettingsRegistryShape> = {},
): SettingsResolution<Record<string, unknown>> {
  const registry = options.registry ?? SETTINGS_REGISTRY
  const diagnostics: SettingsDiagnostic[] = []
  const contributions = collectContributions(registry, layers, diagnostics)

  return { values: buildValues(registry, contributions, options.previous), diagnostics }
}

/**
 * Which layer a write should land in when the caller does not say.
 *
 * The most specific layer that already sets the key, else the user file. That
 * matches what a settings page implies: changing a value a workspace already
 * pins should edit the workspace file, not write a user-level value that the
 * workspace immediately overrides — which would look like the setting ignored
 * the click.
 *
 * A layer that may not carry the key at all is skipped, so a scope-filtered
 * value never attracts a write it would fail to apply.
 */
export function deriveWriteTarget(
  id: string,
  layers: readonly SettingsLayer[],
  registry: SettingsRegistryShape = SETTINGS_REGISTRY,
): 'user' | 'workspace' {
  const descriptor = registry[id]
  if (!descriptor) return 'user'
  if (!SCOPES_BY_LAYER.workspace.includes(descriptor.scope)) return 'user'

  const workspace = layers.find((layer) => layer.id === 'workspace')

  return workspace && Object.hasOwn(workspace.raw, id) ? 'workspace' : 'user'
}

/** Ids a policy layer names, which the write path must refuse rather than silently drop. */
export function policyControlledIds(
  layers: readonly SettingsLayer[],
  registry: SettingsRegistryShape = SETTINGS_REGISTRY,
): string[] {
  const policy = layers.find((layer) => layer.id === 'policy')
  if (!policy) return []

  return Object.keys(policy.raw).filter((id) => Object.hasOwn(registry, id))
}

type SettingLayerValue = {
  readonly layer: SettingsLayerId
  /** Straight from `raw`: present even when scope or validation rejected it. */
  readonly value: unknown
  readonly applied: boolean
}

export type SettingInspection = {
  readonly id: string
  readonly defaultValue: unknown
  readonly layers: readonly SettingLayerValue[]
  readonly effective: unknown
  readonly effectiveLayer: SettingsLayerId | 'default'
}

/**
 * Per-layer view of one key, for the page's "also modified in <scope>" hint and
 * its reset affordance.
 *
 * Reads the effective value out of a resolution the caller already has rather
 * than recomputing it, so `inspect` and the resolved document cannot disagree.
 */
export function inspectSetting(
  id: SettingId | string,
  layers: readonly SettingsLayer[],
  resolution: SettingsResolution<Record<string, unknown>>,
  registry: SettingsRegistryShape = SETTINGS_REGISTRY,
): SettingInspection {
  const descriptor = registry[id]
  const present = orderedLayers(layers).filter((layer) => Object.hasOwn(layer.raw, id))
  const layerValues = present.map((layer) => ({
    layer: layer.id,
    value: layer.raw[id],
    applied: accept(registry, layer, id, layer.raw[id]).ok,
  }))
  const winner = layerValues.filter((entry) => entry.applied).at(-1)

  return {
    id,
    defaultValue: descriptor?.default,
    layers: layerValues,
    effective: resolution.values[id],
    effectiveLayer: winner ? winner.layer : 'default',
  }
}

function orderedLayers(layers: readonly SettingsLayer[]): SettingsLayer[] {
  return SETTINGS_LAYER_ORDER.flatMap((id) => layers.filter((layer) => layer.id === id))
}

function collectContributions(
  registry: SettingsRegistryShape,
  layers: readonly SettingsLayer[],
  diagnostics: SettingsDiagnostic[],
): Map<string, Contribution[]> {
  const contributions = new Map<string, Contribution[]>()

  for (const layer of orderedLayers(layers)) {
    collectLayer(registry, layer, contributions, diagnostics)
  }

  return contributions
}

function collectLayer(
  registry: SettingsRegistryShape,
  layer: SettingsLayer,
  contributions: Map<string, Contribution[]>,
  diagnostics: SettingsDiagnostic[],
) {
  for (const [id, rawValue] of migratedEntries(layer, diagnostics)) {
    const acceptance = accept(registry, layer, id, rawValue)
    if (!acceptance.ok) {
      diagnostics.push(acceptance.diagnostic)
      continue
    }

    const existing = contributions.get(id)
    if (existing) {
      existing.push({ layer: layer.id, value: acceptance.value })
      continue
    }

    contributions.set(id, [{ layer: layer.id, value: acceptance.value }])
  }
}

/**
 * This layer's keys, with retired ids resolved to where their value lives today.
 *
 * Runs before `accept` so a migrated value meets the new key's schema and scope
 * rules like any other — a rename does not get to bypass the workspace scope
 * boundary just because the old id predates it.
 *
 * Read-time only. `layer.raw` is untouched, which keeps the file byte-identical
 * until the user next writes it and keeps an older build able to read its own
 * key back. Rewriting settings.json to chase a rename would be a destructive
 * answer to a problem that has a non-destructive one.
 */
function migratedEntries(
  layer: SettingsLayer,
  diagnostics: SettingsDiagnostic[],
): [string, unknown][] {
  const raw = Object.entries(layer.raw)
  // Seeded with what the file already says, so an explicit value for the new id
  // wins over one recovered from the old id no matter which order they appear
  // in. The migrated value is a fossil of a question the user has since
  // answered directly.
  const taken = new Set(raw.map(([id]) => id))
  const entries: [string, unknown][] = []

  for (const [id, value] of raw) {
    const outcome = migrateSetting(id, value)

    if (outcome.kind === 'none') {
      entries.push([id, value])
      continue
    }

    if (outcome.kind === 'removed') {
      diagnostics.push({ kind: 'removed-key', id, layer: layer.id, detail: outcome.reason })
      continue
    }

    if (taken.has(outcome.id)) {
      diagnostics.push({
        kind: 'migrated',
        id,
        layer: layer.id,
        detail: `${outcome.reason} ${outcome.id} is already set, so this older key is ignored.`,
      })
      continue
    }

    taken.add(outcome.id)
    diagnostics.push({
      kind: 'migrated',
      id,
      layer: layer.id,
      detail: `${outcome.reason} Your value now applies to ${outcome.id}.`,
    })
    entries.push([outcome.id, outcome.value])
  }

  return entries
}

/**
 * Unknown keys are rejected as contributions but never removed from `raw`, so a
 * key written by a build that has it survives a build that does not. That is a
 * promise the provider config already makes: an entry for a driver this build
 * cannot load still round-trips through a save untouched.
 */
function accept(
  registry: SettingsRegistryShape,
  layer: SettingsLayer,
  id: string,
  rawValue: unknown,
): Acceptance {
  const descriptor: SettingDescriptor | undefined = registry[id]
  if (!descriptor) {
    return { ok: false, diagnostic: { kind: 'unknown-key', id, layer: layer.id } }
  }

  if (!SCOPES_BY_LAYER[layer.id].includes(descriptor.scope)) {
    return {
      ok: false,
      diagnostic: {
        kind: 'scope-not-allowed',
        id,
        layer: layer.id,
        detail: `${descriptor.scope} settings cannot be set in ${layer.id} settings`,
      },
    }
  }

  const parsed = v.safeParse(descriptor.schema, rawValue)
  if (!parsed.success) {
    return {
      ok: false,
      diagnostic: {
        kind: 'invalid-value',
        id,
        layer: layer.id,
        detail: v.summarize(parsed.issues).replaceAll('\n', ' '),
      },
    }
  }

  return { ok: true, value: parsed.output }
}

function buildValues(
  registry: SettingsRegistryShape,
  contributions: Map<string, Contribution[]>,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  for (const id of Object.keys(registry)) {
    values[id] = reuseOrCombine(registry, id, contributions.get(id), previous)
  }

  return values
}

function reuseOrCombine(
  registry: SettingsRegistryShape,
  id: string,
  entries: Contribution[] | undefined,
  previous: Record<string, unknown> | undefined,
): unknown {
  const combined = combine(registry, id, entries)
  if (!previous || !Object.hasOwn(previous, id)) return combined

  const before = previous[id]

  return jsonEqual(before, combined) ? before : combined
}

function combine(
  registry: SettingsRegistryShape,
  id: string,
  entries: Contribution[] | undefined,
): unknown {
  const descriptor = registry[id]
  if (!entries || entries.length === 0) return descriptor.default

  const last = entries[entries.length - 1]

  // Policy replaces outright even for merging keys. A managed value that merged
  // with the user's would not be managed — the point of the layer is that the
  // administrator's answer is the answer.
  if (last.layer === 'policy') return last.value
  if (descriptor.merge !== 'record') return last.value

  // One contributor needs no merge — returning the parsed value straight through
  // skips a spread. Stable identity across resolves comes from `previous`, not
  // from here: `v.parse` allocates a fresh record every time regardless.
  if (entries.length === 1) return entries[0].value

  return mergeRecords(entries)
}

function mergeRecords(entries: readonly Contribution[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}

  for (const entry of entries) {
    if (!isRecord(entry.value)) continue
    Object.assign(merged, entry.value)
  }

  return merged
}
