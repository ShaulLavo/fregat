import {
  discardSettingsIntent,
  submitSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { simulateLatency } from '@/lib/simulated-latency'
import { createApplicationRuntime } from '@/state/application-runtime'
import { expect, test } from '../../../test/fixtures'
import { settingsSnapshot } from '../../../test/factories/settings'
import { testScopedStorage } from '../../../test/factories/scoped-storage'

test('settings reach the latency dial, machines and spellcheck without a React tree, optimistic writes included', () => {
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(testScopedStorage),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  const settings = primaryQueryClient()
  const spellcheck = application.getSnapshot().editor.spellcheck
  const machineNames = () => application.connections.store.getState().machines.map((m) => m.name)
  const intents: string[] = []
  const set = (operation: Parameters<typeof submitSettingsIntent>[2][number]) =>
    intents.push(submitSettingsIntent(settings, 'user', [operation]).entry.intentId)

  try {
    settings.setQueryData(
      settingsKeys.document(),
      settingsSnapshot({
        values: {
          'developer.simulatedLatencyMs': 40,
          'environments.machines': {
            remote: { kind: 'origin', url: 'http://localhost:37990', label: 'Remote' },
          },
          'spellcheck.words': { fregat: true, teh: false },
        },
      }),
    )
    expect(simulateLatency()).toBeInstanceOf(Promise)
    expect(spellcheck.isAccepted('fregat')).toBe(true)
    expect(spellcheck.isAccepted('teh')).toBe(false)
    expect(machineNames()).toEqual(['remote'])

    set({ kind: 'set', key: 'developer.simulatedLatencyMs', value: 0 })
    set({ kind: 'spellcheck.setWord', word: 'fregat', accepted: false })
    set({ kind: 'spellcheck.setWord', word: 'teh', accepted: true })
    set({ kind: 'machine.remove', name: 'remote' })
    expect(simulateLatency()).toBeUndefined()
    expect(spellcheck.isAccepted('fregat')).toBe(false)
    expect(spellcheck.isAccepted('teh')).toBe(true)
    expect(machineNames()).toEqual([])
  } finally {
    for (const intentId of intents) discardSettingsIntent(intentId)
    application.dispose()
    settings.removeQueries({ queryKey: settingsKeys.document() })
  }
})
