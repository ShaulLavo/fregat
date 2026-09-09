import {
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type ProviderSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'

import { expect, test } from '../../../../../test/fixtures'

import {
  providerModelOptionGroups,
  providerModelOptions,
  providerModelSelectionKey,
} from '@workspace/client-core/chat/providers/models'
import { providerModel as model, providerSnapshot } from '../../../../../test/factories/chat'

function codex(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return providerSnapshot({ models: [model()], ...overrides })
}

function anthropic(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return codex({
    displayLabel: 'Anthropic',
    driverKind: v.parse(providerDriverKindSchema, 'claude'),
    models: [model({ name: 'Claude Opus 5', shortName: undefined, slug: 'claude-opus-5' })],
    providerInstanceId: v.parse(providerInstanceIdSchema, 'anthropic'),
    ...overrides,
  })
}

function firstDisabledReason(snapshot: ProviderSnapshot) {
  return providerModelOptions([snapshot])[0].disabledReason
}

test('a ready provider yields pickable options carrying the full model projection', () => {
  const [option] = providerModelOptions([codex()])

  expect(option).toMatchObject({
    defaultEffort: null,
    disabledReason: null,
    driverKind: 'codex',
    effortLevels: [],
    isCustom: false,
    key: 'codex:gpt-5.5',
    label: 'GPT-5.5',
    modelSelection: { model: 'gpt-5.5', providerInstanceId: 'codex' },
    name: 'GPT-5.5 Codex',
    providerInstanceId: 'codex',
    providerLabel: 'Codex',
    shortName: 'GPT-5.5',
    statusLabel: 'Ready',
  })
})

test('an option carries the reasoning levels its model advertises', () => {
  const [option] = providerModelOptions([
    codex({
      models: [
        model({
          capabilities: {
            defaultReasoningEffort: 'medium',
            reasoningEfforts: [
              { description: 'Fastest.', effort: 'low' },
              { description: 'Balanced.', effort: 'medium' },
            ],
          },
        }),
      ],
    }),
  ])

  expect(option.defaultEffort).toBe('medium')
  expect(option.effortLevels).toEqual([
    { description: 'Fastest.', effort: 'low', label: 'Low' },
    { description: 'Balanced.', effort: 'medium', label: 'Medium' },
  ])
})

test('a model without a short name falls back to its full name', () => {
  const [option] = providerModelOptions([anthropic()])

  expect(option).toMatchObject({ label: 'Claude Opus 5', name: 'Claude Opus 5', shortName: null })
})

test('each unavailability condition yields its own kind and sentence', () => {
  const reasons = [
    firstDisabledReason(codex({ enabled: false })),
    firstDisabledReason(codex({ installed: false })),
    firstDisabledReason(codex({ availability: 'unavailable' })),
    firstDisabledReason(codex({ auth: { status: 'unauthenticated' }, status: 'error' })),
    firstDisabledReason(codex({ status: 'error' })),
  ]

  expect(reasons.map((reason) => reason?.kind)).toEqual([
    'disabled',
    'not-installed',
    'unavailable',
    'sign-in',
    'not-ready',
  ])
  expect(reasons.map((reason) => reason?.message)).toEqual([
    'Codex is disabled in settings.',
    'Codex is not installed.',
    'Codex is unavailable right now.',
    'Codex is signed out. Sign in to use its models.',
    'Codex is not ready.',
  ])
  expect(new Set(reasons.map((reason) => reason?.message)).size).toBe(reasons.length)
})

test('a signed-out provider reads as sign-in, not as a generic failure', () => {
  const snapshot = codex({
    auth: { status: 'unauthenticated' },
    message: 'Claude Code is not signed in.',
    status: 'error',
  })
  const [option] = providerModelOptions([snapshot])

  // The row line has to say what to do, not repeat the provider name.
  expect(option.disabledReason?.label).toBe('Sign in required')
  expect(option.statusLabel).toBe('Sign in required')
})

test('an uninstalled provider is not mistaken for a signed-out one', () => {
  const reason = firstDisabledReason(
    codex({ auth: { status: 'unauthenticated' }, installed: false }),
  )

  expect(reason?.kind).toBe('not-installed')
})

test('the provider message wins over the generic not-ready sentence', () => {
  const reason = firstDisabledReason(codex({ message: 'Rate limited until 4pm.', status: 'error' }))

  expect(reason).toMatchObject({ kind: 'not-ready', message: 'Rate limited until 4pm.' })
})

test('a warning provider stays pickable and surfaces its message as the status label', () => {
  const snapshot = codex({ message: 'Update available.', status: 'warning' })
  const [option] = providerModelOptions([snapshot])

  expect(option).toMatchObject({ disabledReason: null, statusLabel: 'Update available.' })
})

test('a group offers sign-in only when the server can drive that provider', () => {
  const [offered, textOnly] = providerModelOptionGroups([
    anthropic({ auth: { status: 'unauthenticated' }, supportsSignIn: true }),
    codex({ auth: { status: 'unauthenticated' } }),
  ])

  expect(offered.signInTarget).toEqual({
    providerInstanceId: 'anthropic',
    providerLabel: 'Anthropic',
  })
  // No in-app flow: the rows still say "Sign in required", but nothing offers a
  // button the server would reject.
  expect(textOnly.options[0].disabledReason?.kind).toBe('sign-in')
  expect(textOnly.signInTarget).toBe(null)
})

test('a signed-in group offers nothing to sign in to', () => {
  const [group] = providerModelOptionGroups([codex({ supportsSignIn: true })])

  expect(group.signInTarget).toBe(null)
})

test('grouping preserves server order and drops providers with no models', () => {
  const groups = providerModelOptionGroups([
    anthropic(),
    codex({ models: [] }),
    codex({
      models: [model({ slug: 'gpt-5.5-mini' }), model({ isCustom: true, slug: 'gpt-5.5-custom' })],
      status: 'warning',
    }),
  ])

  expect(groups.map((group) => group.providerInstanceId)).toEqual(['anthropic', 'codex'])
  expect(groups[0]).toMatchObject({ displayLabel: 'Anthropic', status: 'ready' })
  expect(groups[1].status).toBe('warning')
  expect(groups[1].options.map((option) => option.modelSelection.model)).toEqual([
    'gpt-5.5-mini',
    'gpt-5.5-custom',
  ])
  expect(groups[1].options[1].isCustom).toBe(true)
})

test('the flat option list is the groups concatenated in order', () => {
  const providers = [anthropic(), codex()]
  const flatKeys = providerModelOptions(providers).map((option) => option.key)
  const groupedKeys = providerModelOptionGroups(providers).flatMap((group) =>
    group.options.map((option) => option.key),
  )

  expect(flatKeys).toEqual(groupedKeys)
})

test('missing providers yield nothing', () => {
  expect(providerModelOptions(undefined)).toEqual([])
  expect(providerModelOptionGroups(undefined)).toEqual([])
})

test('the selection key round-trips a provider instance and model', () => {
  const [option] = providerModelOptions([anthropic()])

  expect(option.key).toBe('anthropic:claude-opus-5')
  expect(providerModelSelectionKey(option.modelSelection)).toBe(option.key)
})
