import { deepStrictEqual, notDeepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import * as v from 'valibot'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  type ModelSelection,
  type ProviderOptionDescriptor,
} from '../../packages/contracts/src/index'
import { reconcileModelOptions } from '../../packages/client-core/src/chat/providers/options'
import {
  claudeCatalog,
  DEFAULT_CLAUDE_MODEL,
} from '../../apps/server/src/provider/adapters/utils/claude-models'
import { pin, readPinned } from './pinned'

const source = readPinned('packages/shared/src/model.ts')
function extract(start: string, end: string) {
  strictEqual(source.split(start).length, 2)
  strictEqual(source.split(end).length, 2)
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}
const selected = extract(
  'function getRawSelectionValueById(',
  'export function isClaudeUltrathinkPrompt(',
)
const trim = extract('function trimOrNull<', 'function cloneSelections(')
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${selected}\n${trim}`)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const selectionsSchema = v.optional(
  v.array(
    v.object({
      id: v.string(),
      value: v.union([v.string(), v.boolean()]),
    }),
  ),
)
const base = { model: 'fixture-model', providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID }

function pinnedOptions(
  descriptors: readonly ProviderOptionDescriptor[],
  selection: ModelSelection,
) {
  const selections = Object.entries(selection.options ?? {}).map(([id, value]) => ({ id, value }))
  const resolved: unknown = upstream.getProviderOptionDescriptors({
    caps: { optionDescriptors: descriptors },
    selections,
  })
  const result: unknown = upstream.buildExplicitProviderOptionSelectionsFromDescriptors(
    resolved,
    selections,
  )
  const parsed = v.parse(selectionsSchema, result)
  return Object.fromEntries((parsed ?? []).map(({ id, value }) => [id, value]))
}

// Departure: upstream swaps a prompt-injected level for the default; ours stores it like any
// level and the server adds the word to the prompt.
function expectedOptions(descriptor: ProviderOptionDescriptor, previous: ModelSelection) {
  if (descriptor.type !== 'select') return pinnedOptions([descriptor], previous)
  const { promptInjectedValues: _, ...plain } = descriptor
  return pinnedOptions([plain], previous)
}

const choiceSets = [
  [],
  [{ id: 'standard', label: 'Standard' }],
  [
    { id: 'standard', label: 'Standard', isDefault: true },
    { id: 'future-id', label: 'Future' },
  ],
]
const currents = [undefined, 'standard', 'future-id', 'stale-id']
const values = [undefined, '', ' standard ', 'future-id', 'stale-id', true, false]
const descriptors: ProviderOptionDescriptor[] = choiceSets.flatMap((options) =>
  currents.flatMap(
    (currentValue) =>
      [
        { id: 'serviceTier', label: 'Service tier', type: 'select', options, currentValue },
        {
          id: 'serviceTier',
          label: 'Service tier',
          type: 'select',
          options,
          currentValue,
          promptInjectedValues: ['future-id'],
        },
      ] satisfies ProviderOptionDescriptor[],
  ),
)
descriptors.push(
  ...[undefined, true, false].map((currentValue) => ({
    id: 'thinking',
    label: 'Thinking',
    type: 'boolean' as const,
    currentValue,
  })),
)

let cases = 0
for (const descriptor of descriptors) {
  for (const value of values) {
    const previous = { ...base, options: value === undefined ? {} : { [descriptor.id]: value } }
    const expected = expectedOptions(descriptor, previous)
    const actual = reconcileModelOptions(previous, base, [descriptor]).options ?? {}
    deepStrictEqual(actual, expected, JSON.stringify({ descriptor, value }))
    cases += 1
  }
}

const tier: ProviderOptionDescriptor = {
  id: 'serviceTier',
  label: 'Service tier',
  type: 'select',
  options: [
    { id: 'default', label: 'Standard', isDefault: true },
    { id: 'priority', label: 'Priority' },
  ],
}
const thinking: ProviderOptionDescriptor = {
  id: 'thinking',
  label: 'Thinking',
  type: 'boolean',
  currentValue: true,
}
const capabilities = [tier, thinking]
const previous = {
  ...base,
  options: { serviceTier: 'priority', thinking: false, unrelated: 'drop-me' },
}
const expected = pinnedOptions(capabilities, previous)
deepStrictEqual(reconcileModelOptions(previous, base, capabilities).options, expected)
cases += 1

const controls = [
  { serviceTier: 'fast', thinking: false },
  { serviceTier: 'priority', thinking: true },
  { serviceTier: 'priority', thinking: false, unrelated: 'drop-me' },
  { thinking: false },
]
for (const control of controls) notDeepStrictEqual(control, expected)
notDeepStrictEqual(
  { serviceTier: 'default', thinking: true },
  pinnedOptions(capabilities, base),
  'Untouched defaults must not be persisted as explicit choices',
)

const manifestSchema = v.object({
  providers: v.object({
    claudeAgent: v.object({
      defaults: v.object({ chat: v.string() }),
      models: v.array(v.object({ slug: v.string(), profile: v.string() })),
      profiles: v.record(v.string(), v.object({ capabilities: v.unknown() })),
    }),
  }),
})
const manifest = v.parse(
  manifestSchema,
  JSON.parse(readPinned('apps/server/src/provider/model-manifest.json')),
)
const claude = manifest.providers.claudeAgent
strictEqual(DEFAULT_CLAUDE_MODEL, claude.defaults.chat)
// The scripts package cannot resolve the SDK, so the row type comes through the mapping.
type ModelInfo = Parameters<typeof claudeCatalog>[0][number]
// supportedModels() as CLI 2.1.281 answered it (Plan 138), trimmed to the fields the mapping reads.
const EFFORT_LEVELS: ModelInfo['supportedEffortLevels'] = ['low', 'medium', 'high', 'xhigh', 'max']
const CLI_2_1_281_ROWS: ModelInfo[] = [
  cliRow('default', 'claude-opus-5-5[1m]', { supportsFastMode: true }),
  cliRow('opus[1m]', 'claude-opus-5-5[1m]', { supportsFastMode: true }),
  cliRow('claude-fable-5-1[1m]', 'claude-fable-5-1', {}),
  cliRow('sonnet', 'claude-sonnet-5', {}),
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: '',
  },
]
function cliRow(
  value: string,
  resolvedModel: string,
  flags: Partial<Pick<ModelInfo, 'supportsFastMode'>>,
) {
  return {
    value,
    resolvedModel,
    displayName: value,
    description: '',
    supportedEffortLevels: EFFORT_LEVELS,
    ...flags,
  } satisfies ModelInfo
}
const catalog = claudeCatalog(CLI_2_1_281_ROWS).models
// Every model the pinned manifest names must map to its profile; a newer CLI model may be absent there.
const pinned = catalog.filter((model) => claude.models.some((entry) => entry.slug === model.slug))
strictEqual(pinned.length, 5)
for (const model of pinned) {
  const advertised = claude.models.find((candidate) => candidate.slug === model.slug)
  ok(advertised, `Pinned Claude model ${model.slug}`)
  deepStrictEqual(
    comparableCapabilities(model.capabilities),
    comparableCapabilities(claude.profiles[advertised.profile]?.capabilities),
    model.slug,
  )
}

// The option ids, types and defaults are the contract; label case and descriptions are our copy.
function comparableCapabilities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparableCapabilities)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, field]) => {
      if (key === 'description') return []
      if (key === 'label' && typeof field === 'string') return [[key, field.toLowerCase()]]
      return [[key, comparableCapabilities(field)]]
    }),
  )
}
console.log(
  JSON.stringify({
    upstreamCommit: pin,
    cases,
    negativeControls: controls.length + 1,
    claudeProfiles: pinned.length,
    result: 'matched',
  }),
)
