import { providerInstanceIdSchema, providerDriverKindSchema } from '@workspace/contracts'
import * as v from 'valibot'

import { resolveChatModelSelection } from '@workspace/client-core/chat/providers/selection'
import { providerModel, providerSnapshot } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const claudeInstanceId = v.parse(providerInstanceIdSchema, 'claude')
const codexInstanceId = v.parse(providerInstanceIdSchema, 'codex')

const opus = providerModel({
  name: 'Claude Opus 5',
  shortName: 'Opus 5',
  slug: 'claude-opus-5',
})

const claude = providerSnapshot({
  displayLabel: 'Claude',
  driverKind: v.parse(providerDriverKindSchema, 'claude'),
  models: [opus],
  providerInstanceId: claudeInstanceId,
  status: 'ready',
})

const reasoningClaude = providerSnapshot({
  displayLabel: 'Claude',
  driverKind: v.parse(providerDriverKindSchema, 'claude'),
  models: [
    providerModel({
      ...opus,
      capabilities: {
        optionDescriptors: [
          {
            id: 'effort',
            label: 'Reasoning',
            type: 'select',
            currentValue: 'high',
            options: [
              { id: 'high', label: 'High', isDefault: true },
              { id: 'max', label: 'Max' },
            ],
          },
        ],
      },
    }),
  ],
  providerInstanceId: claudeInstanceId,
  status: 'ready',
})

// Mirrors the real failure: codex is installed and enabled, but its model/list probe
// failed, so it reports an error status and an empty catalog.
const brokenCodex = providerSnapshot({
  displayLabel: 'Codex',
  models: [],
  providerInstanceId: codexInstanceId,
  status: 'error',
})

test('resolves around a stored provider whose catalog is unavailable', () => {
  const resolved = resolveChatModelSelection([brokenCodex, claude], {
    model: 'gpt-5.5',
    providerInstanceId: codexInstanceId,
  })

  expect(resolved).toEqual({ model: 'claude-opus-5', providerInstanceId: claudeInstanceId })
})

test('keeps a stored selection that is still offered and ready', () => {
  const resolved = resolveChatModelSelection([brokenCodex, claude], {
    model: 'claude-opus-5',
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({ model: 'claude-opus-5', providerInstanceId: claudeInstanceId })
})

test('falls back to the first ready model when nothing is stored', () => {
  expect(resolveChatModelSelection([brokenCodex, claude], null)).toEqual({
    model: 'claude-opus-5',
    providerInstanceId: claudeInstanceId,
  })
})

test('resolves to null when every option is unpickable', () => {
  expect(resolveChatModelSelection([brokenCodex], null)).toBeNull()
  expect(
    resolveChatModelSelection([brokenCodex], {
      model: 'gpt-5.5',
      providerInstanceId: codexInstanceId,
    }),
  ).toBeNull()
})

test('resolves to null before the provider list has loaded', () => {
  expect(resolveChatModelSelection(undefined, null)).toBeNull()
  expect(resolveChatModelSelection([], null)).toBeNull()
})

test('a stored reasoning level survives on a model that still advertises it', () => {
  const resolved = resolveChatModelSelection([reasoningClaude], {
    model: 'claude-opus-5',
    options: { effort: 'max' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({
    model: 'claude-opus-5',
    options: { effort: 'max' },
    providerInstanceId: claudeInstanceId,
  })
})

test('a stored level the catalog dropped falls back to the model default', () => {
  const resolved = resolveChatModelSelection([reasoningClaude], {
    model: 'claude-opus-5',
    options: { effort: 'ultra' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({
    model: 'claude-opus-5',
    options: { effort: 'high' },
    providerInstanceId: claudeInstanceId,
  })
})

test('a stored level is dropped by a model that advertises none', () => {
  const resolved = resolveChatModelSelection([claude], {
    model: 'claude-opus-5',
    options: { effort: 'max' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({ model: 'claude-opus-5', providerInstanceId: claudeInstanceId })
})

test('a stored selection preserves all advertised native options, including false', () => {
  const provider = providerSnapshot({
    ...reasoningClaude,
    models: [
      providerModel({
        ...opus,
        capabilities: {
          optionDescriptors: [
            ...reasoningClaude.models.flatMap(
              (model) => model.capabilities?.optionDescriptors ?? [],
            ),
            {
              id: 'contextWindow',
              label: 'Context window',
              type: 'select',
              options: [
                { id: 'standard', label: 'Standard' },
                { id: '1m', label: '1M' },
              ],
            },
            { id: 'fastMode', label: 'Fast mode', type: 'boolean', currentValue: true },
            { id: 'thinking', label: 'Extended thinking', type: 'boolean' },
          ],
        },
      }),
    ],
  })
  const stored = {
    model: 'claude-opus-5',
    providerInstanceId: claudeInstanceId,
    options: { effort: 'max', contextWindow: '1m', fastMode: false, thinking: true },
  }

  expect(resolveChatModelSelection([provider], stored)).toEqual(stored)
})
