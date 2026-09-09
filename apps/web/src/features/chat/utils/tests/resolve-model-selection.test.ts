import { providerInstanceIdSchema } from '@workspace/contracts'
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
  models: [opus],
  providerInstanceId: claudeInstanceId,
  status: 'ready',
})

const reasoningClaude = providerSnapshot({
  displayLabel: 'Claude',
  models: [
    providerModel({
      ...opus,
      capabilities: {
        defaultReasoningEffort: 'high',
        reasoningEfforts: [{ effort: 'high' }, { effort: 'max' }],
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
    options: { reasoningEffort: 'max' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({
    model: 'claude-opus-5',
    options: { reasoningEffort: 'max' },
    providerInstanceId: claudeInstanceId,
  })
})

test('a stored level the catalog dropped falls back to the model default', () => {
  const resolved = resolveChatModelSelection([reasoningClaude], {
    model: 'claude-opus-5',
    options: { reasoningEffort: 'ultra' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({
    model: 'claude-opus-5',
    options: { reasoningEffort: 'high' },
    providerInstanceId: claudeInstanceId,
  })
})

test('a stored level is dropped by a model that advertises none', () => {
  const resolved = resolveChatModelSelection([claude], {
    model: 'claude-opus-5',
    options: { reasoningEffort: 'max' },
    providerInstanceId: claudeInstanceId,
  })

  expect(resolved).toEqual({ model: 'claude-opus-5', providerInstanceId: claudeInstanceId })
})
